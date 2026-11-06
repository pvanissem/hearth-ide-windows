// hearth-sandbox: runs a command inside a Windows AppContainer (no WSL, no admin rights).
//
//   hearth-sandbox.exe --name <id> [--rw <path>]... [--ro <path>]... [--net none|loopback|internet]
//                      [--env K=V]... [--cwd <dir>] [--pipes] [--revoke] -- <command line>
//
// * Filesystem: the process runs as an AppContainer principal. It can only touch what
//   its container SID was granted (--rw / --ro) plus the system folders that are readable
//   by ALL APPLICATION PACKAGES. Grants are ACEs on the folders, one container per name.
// * Network: none (default), loopback (only the local filtering proxy), or internet.
// * The process lives in a job object: when the helper ends, the whole tree is killed.
// * --revoke removes the ACEs again and deletes the container profile.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

static class Native
{
    public const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000, CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_SUSPENDED = 4;
    public const uint STARTF_USESTDHANDLES = 0x100;
    public static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = (IntPtr)0x20009;
    public const int STD_INPUT_HANDLE = -10, STD_OUTPUT_HANDLE = -11, STD_ERROR_HANDLE = -12;
    public const int HRESULT_ALREADY_EXISTS = unchecked((int)0x800700B7);

    [StructLayout(LayoutKind.Sequential)] public struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] public struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute; public uint dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool ConvertSidToStringSid(IntPtr sid, out string s);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")] public static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int len);
    [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] public static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll")] public static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(HandlerRoutine h, bool add);
    public delegate bool HandlerRoutine(uint ctrlType);
}

class Options
{
    public string Name = "default", Net = "none", Cwd;
    public bool Pipes, Revoke, PrintSid;
    public List<string> Rw = new List<string>(), Ro = new List<string>(), Env = new List<string>(), DenyWrite = new List<string>();
    public string CommandLine;
}

static class Program
{
    static int Fail(string msg) { Console.Error.WriteLine("hearth-sandbox: " + msg); return 125; }

    static Options Parse(string[] a)
    {
        var o = new Options();
        for (int i = 0; i < a.Length; i++)
        {
            switch (a[i])
            {
                case "--name": o.Name = a[++i]; break;
                case "--rw": o.Rw.Add(a[++i]); break;
                case "--ro": o.Ro.Add(a[++i]); break;
                case "--net": o.Net = a[++i]; break;
                case "--env": o.Env.Add(a[++i]); break;
                case "--cwd": o.Cwd = a[++i]; break;
                case "--pipes": o.Pipes = true; break;
                case "--revoke": o.Revoke = true; break;
                case "--print-sid": o.PrintSid = true; break;
                case "--deny-write": o.DenyWrite.Add(a[++i]); break;
                // The command line as one base64 (UTF-8) token: no quoting problems between node-pty and us.
                case "--cmd64": o.CommandLine = Encoding.UTF8.GetString(Convert.FromBase64String(a[++i])); break;
                case "--":
                    o.CommandLine = string.Join(" ", a, i + 1, a.Length - i - 1);
                    return o;
                default: throw new ArgumentException("unknown option " + a[i]);
            }
        }
        return o;
    }

    static string ContainerName(string name)
    {
        var sb = new StringBuilder("hearth.");
        foreach (var c in name.ToLowerInvariant()) sb.Append(char.IsLetterOrDigit(c) || c == '.' || c == '-' ? c : '_');
        return sb.ToString(0, Math.Min(sb.Length, 60));
    }

    static IntPtr ContainerSid(string container)
    {
        IntPtr sid;
        int hr = Native.CreateAppContainerProfile(container, "Hearth sandbox", "Hearth IDE agent sandbox", IntPtr.Zero, 0, out sid);
        if (hr == Native.HRESULT_ALREADY_EXISTS) hr = Native.DeriveAppContainerSidFromAppContainerName(container, out sid);
        if (hr != 0) throw new Win32Exception(hr);
        return sid;
    }

    static void Grant(string path, SecurityIdentifier sid, FileSystemRights rights)
    {
        if (Directory.Exists(path))
        {
            var di = new DirectoryInfo(path);
            var sec = di.GetAccessControl();
            sec.AddAccessRule(new FileSystemAccessRule(sid, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            di.SetAccessControl(sec);
        }
        else if (File.Exists(path))
        {
            var fi = new FileInfo(path);
            var sec = fi.GetAccessControl();
            sec.AddAccessRule(new FileSystemAccessRule(sid, rights, AccessControlType.Allow));
            fi.SetAccessControl(sec);
        }
        else throw new FileNotFoundException("not found: " + path);
    }

    static void Revoke(string path, SecurityIdentifier sid)
    {
        try
        {
            if (Directory.Exists(path)) { var di = new DirectoryInfo(path); var s = di.GetAccessControl(); s.PurgeAccessRules(sid); di.SetAccessControl(s); }
            else if (File.Exists(path)) { var fi = new FileInfo(path); var s = fi.GetAccessControl(); s.PurgeAccessRules(sid); fi.SetAccessControl(s); }
        }
        catch (Exception e) { Console.Error.WriteLine("hearth-sandbox: could not revoke " + path + ": " + e.Message); }
    }

    /// Undo a read-only island: forget the container and let the folder inherit from its parent again.
    static void RevokeIsland(string path, SecurityIdentifier sid)
    {
        try
        {
            if (!Directory.Exists(path)) return;
            var di = new DirectoryInfo(path);
            var sec = di.GetAccessControl();
            sec.PurgeAccessRules(sid);
            sec.SetAccessRuleProtection(false, false);
            di.SetAccessControl(sec);
        }
        catch (Exception e) { Console.Error.WriteLine("hearth-sandbox: could not restore " + path + ": " + e.Message); }
    }

    static string JsonString(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (var c in s)
        {
            if (c == '\\' || c == '"') sb.Append('\\').Append(c);
            else if (c < 32 || (c >= 127 && c < 160)) sb.Append(' ');
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    // hearth-journal step|decision|question <id> [--parent ID] [--title T] [--status S] [--why T] [--rejected T]... [--answer T]
    // Appends one JSON line to %HEARTH_JOURNAL%. Runs inside the sandbox (only that file is writable there).
    static int JournalMain(string[] a)
    {
        string file = Environment.GetEnvironmentVariable("HEARTH_JOURNAL");
        if (string.IsNullOrEmpty(file)) { Console.Error.WriteLine("hearth-journal: not inside a Hearth session"); return 2; }
        if (a.Length < 3 || (a[1] != "step" && a[1] != "decision" && a[1] != "question"))
        { Console.Error.WriteLine("usage: hearth-journal step|decision|question <id> [--parent ID] [--title T] [--status S] [--why T] [--rejected T]... [--answer T]"); return 2; }
        var json = new StringBuilder("{\"t\":" + JsonString(a[1]) + ",\"id\":" + JsonString(a[2]));
        var rejected = new List<string>();
        for (int i = 3; i + 1 < a.Length; i += 2)
        {
            switch (a[i])
            {
                case "--parent": json.Append(",\"parent\":" + JsonString(a[i + 1])); break;
                case "--title": json.Append(",\"title\":" + JsonString(a[i + 1])); break;
                case "--status": json.Append(",\"status\":" + JsonString(a[i + 1])); break;
                case "--why": json.Append(",\"why\":" + JsonString(a[i + 1])); break;
                case "--answer": json.Append(",\"answer\":" + JsonString(a[i + 1])); break;
                case "--rejected": rejected.Add(JsonString(a[i + 1])); break;
                default: Console.Error.WriteLine("unknown option " + a[i]); return 2;
            }
        }
        if (rejected.Count > 0) json.Append(",\"rejected\":[" + string.Join(",", rejected.ToArray()) + "]");
        json.Append("}\n");
        using (var fs = new FileStream(file, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
        { var bytes = new UTF8Encoding(false).GetBytes(json.ToString()); fs.Write(bytes, 0, bytes.Length); }
        return 0;
    }

    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "journal") return JournalMain(args);
        Options o;
        try { o = Parse(args); } catch (Exception e) { return Fail(e.Message); }
        string container = ContainerName(o.Name);
        IntPtr sidPtr;
        try { sidPtr = ContainerSid(container); } catch (Exception e) { return Fail("cannot create container: " + e.Message); }
        string sidText; Native.ConvertSidToStringSid(sidPtr, out sidText);
        var sid = new SecurityIdentifier(sidText);

        if (o.PrintSid) { Console.WriteLine(sidText); return 0; }
        if (o.Revoke)
        {
            foreach (var p in o.Rw) Revoke(p, sid);
            foreach (var p in o.DenyWrite) RevokeIsland(p, sid);
            foreach (var p in o.Ro) Revoke(p, sid);
            Native.DeleteAppContainerProfile(container);
            return 0;
        }
        if (string.IsNullOrEmpty(o.CommandLine)) return Fail("no command");

        try
        {
            foreach (var p in o.Ro) Grant(p, sid, FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize);
            foreach (var p in o.Rw) Grant(p, sid, FileSystemRights.Modify | FileSystemRights.Synchronize);
            // Read-only islands inside a writable tree (e.g. .git/hooks, which runs code outside the sandbox).
            // Deny ACEs do not stop an AppContainer from writing, so inheritance is cut instead and the
            // container only gets ReadAndExecute there.
            foreach (var p in o.DenyWrite)
            {
                if (!Directory.Exists(p)) continue;
                var di = new DirectoryInfo(p);
                var sec = di.GetAccessControl();
                sec.SetAccessRuleProtection(true, true);          // keep what was inherited as explicit entries
                di.SetAccessControl(sec);
                sec = di.GetAccessControl();
                sec.PurgeAccessRules(sid);                         // drop the container's inherited Modify
                sec.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
                di.SetAccessControl(sec);
            }
        }
        catch (Exception e) { return Fail("cannot grant access: " + e.Message); }

        // Capabilities: internet = outbound internet; loopback = private network client/server (local proxy only).
        var caps = new List<string>();
        if (o.Net == "internet") caps.Add("S-1-15-3-1");
        else if (o.Net == "loopback") caps.Add("S-1-15-3-3");
        int capSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(Native.SID_AND_ATTRIBUTES));
        IntPtr capArray = Marshal.AllocHGlobal(Math.Max(1, caps.Count) * capSize);
        for (int i = 0; i < caps.Count; i++)
        {
            IntPtr cs; if (!Native.ConvertStringSidToSid(caps[i], out cs)) return Fail("bad capability sid");
            Marshal.StructureToPtr(new Native.SID_AND_ATTRIBUTES { Sid = cs, Attributes = 4 }, capArray + i * capSize, false);
        }
        var sc = new Native.SECURITY_CAPABILITIES { AppContainerSid = sidPtr, Capabilities = caps.Count > 0 ? capArray : IntPtr.Zero, CapabilityCount = (uint)caps.Count };
        IntPtr scPtr = Marshal.AllocHGlobal(Marshal.SizeOf(sc));
        Marshal.StructureToPtr(sc, scPtr, false);

        IntPtr size = IntPtr.Zero;
        Native.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        IntPtr attrs = Marshal.AllocHGlobal(size);
        if (!Native.InitializeProcThreadAttributeList(attrs, 1, 0, ref size)) return Fail("attribute list: " + Marshal.GetLastWin32Error());
        if (!Native.UpdateProcThreadAttribute(attrs, 0, Native.PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, scPtr, (IntPtr)Marshal.SizeOf(sc), IntPtr.Zero, IntPtr.Zero))
            return Fail("security capabilities: " + Marshal.GetLastWin32Error());

        var si = new Native.STARTUPINFOEX();
        si.StartupInfo.cb = Marshal.SizeOf(typeof(Native.STARTUPINFOEX));
        si.lpAttributeList = attrs;
        bool inherit = false;
        if (o.Pipes)
        {
            si.StartupInfo.dwFlags = Native.STARTF_USESTDHANDLES;
            si.StartupInfo.hStdInput = Native.GetStdHandle(Native.STD_INPUT_HANDLE);
            si.StartupInfo.hStdOutput = Native.GetStdHandle(Native.STD_OUTPUT_HANDLE);
            si.StartupInfo.hStdError = Native.GetStdHandle(Native.STD_ERROR_HANDLE);
            foreach (var h in new[] { si.StartupInfo.hStdInput, si.StartupInfo.hStdOutput, si.StartupInfo.hStdError }) Native.SetHandleInformation(h, 1, 1);
            inherit = true;
        }

        // Environment: the parent's, plus overrides (private HOME/TEMP etc.).
        var env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables()) env[(string)e.Key] = (string)e.Value;
        foreach (var kv in o.Env) { int eq = kv.IndexOf('='); if (eq > 0) env[kv.Substring(0, eq)] = kv.Substring(eq + 1); }
        var envBlock = new StringBuilder();
        foreach (var kv in env) envBlock.Append(kv.Key).Append('=').Append(kv.Value).Append('\0');
        envBlock.Append('\0');
        IntPtr envPtr = Marshal.StringToHGlobalUni(envBlock.ToString());

        // The helper is the only process outside the container; make sure the job dies with it.
        IntPtr job = Native.CreateJobObject(IntPtr.Zero, null);
        var limit = new Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limit.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
        Native.SetInformationJobObject(job, 9, ref limit, Marshal.SizeOf(limit));

        Native.PROCESS_INFORMATION pi;
        var cmd = new StringBuilder(o.CommandLine);
        if (!Native.CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, inherit, Native.EXTENDED_STARTUPINFO_PRESENT | Native.CREATE_UNICODE_ENVIRONMENT | Native.CREATE_SUSPENDED,
                envPtr, o.Cwd, ref si, out pi))
            return Fail("cannot start: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
        Native.AssignProcessToJobObject(job, pi.hProcess);
        Native.SetConsoleCtrlHandler(c => true, true); // Ctrl+C goes to the child, not to us
        Native.ResumeThread(pi.hThread);
        Native.WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint code; Native.GetExitCodeProcess(pi.hProcess, out code);
        Native.CloseHandle(job);
        return (int)code;
    }
}
