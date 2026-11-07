'use strict';
// Editor intelligence on top of Monaco. JavaScript / TypeScript use Monaco's own language service (types, hover,
// signature help). Java and Go have no language server here, so they get: keywords, snippets, standard-library members,
// the symbols of the open files and of the project, hover and an outline (Ctrl+Shift+O in the editor is Monaco's).
(() => {
  const k = (name, sig) => ({ name, sig });
  /** "Name(args)" is a function, plain "Name" a field / constant / type. */
  const list = (s) => s.split(/\s{2,}|\n/).map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('('); return i < 0 ? k(x, null) : k(x.slice(0, i), x.slice(i)); });

  const GO = {
    keywords: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'.split(' '),
    typeNames: 'any bool byte comparable complex128 complex64 error float32 float64 int int16 int32 int64 int8 rune string uint uint16 uint32 uint64 uint8 uintptr nil true false iota'.split(' '),
    builtins: list('append(slice, elems...)  cap(v)  clear(m)  close(ch)  copy(dst, src)  delete(m, key)  len(v)  make(t, size)  max(a, b)  min(a, b)  new(T)  panic(v)  print(args)  println(args)  recover()'),
    packages: {
      fmt: list('Println(a ...any)  Printf(format string, a ...any)  Print(a ...any)  Sprintf(format string, a ...any)  Sprint(a ...any)  Sprintln(a ...any)  Errorf(format string, a ...any) error  Fprintf(w io.Writer, format string, a ...any)  Fprintln(w io.Writer, a ...any)  Sscanf(str, format string, a ...any)  Scanln(a ...any)  Stringer'),
      strings: list('Contains(s, substr string) bool  HasPrefix(s, prefix string) bool  HasSuffix(s, suffix string) bool  Split(s, sep string) []string  Join(elems []string, sep string) string  Replace(s, old, new string, n int) string  ReplaceAll(s, old, new string) string  TrimSpace(s string) string  Trim(s, cutset string) string  TrimPrefix(s, prefix string) string  TrimSuffix(s, suffix string) string  ToLower(s string) string  ToUpper(s string) string  Index(s, substr string) int  Fields(s string) []string  Repeat(s string, count int) string  EqualFold(s, t string) bool  Count(s, substr string) int  NewReader(s string) *Reader  NewReplacer(oldnew ...string) *Replacer  Builder  Cut(s, sep string)'),
      strconv: list('Atoi(s string) (int, error)  Itoa(i int) string  ParseInt(s string, base int, bitSize int) (int64, error)  ParseFloat(s string, bitSize int) (float64, error)  ParseBool(str string) (bool, error)  FormatInt(i int64, base int) string  Quote(s string) string'),
      os: list('Args  Exit(code int)  Getenv(key string) string  Setenv(key, value string) error  ReadFile(name string) ([]byte, error)  WriteFile(name string, data []byte, perm FileMode) error  Open(name string) (*File, error)  Create(name string) (*File, error)  Stdout  Stderr  Stdin  MkdirAll(path string, perm FileMode) error  Remove(name string) error  RemoveAll(path string) error  Getwd() (string, error)  Environ() []string  Stat(name string) (FileInfo, error)  IsNotExist(err error) bool  ReadDir(name string) ([]DirEntry, error)  Signal  Interrupt'),
      errors: list('New(text string) error  Is(err, target error) bool  As(err error, target any) bool  Unwrap(err error) error  Join(errs ...error) error'),
      time: list('Now() Time  Since(t Time) Duration  Sleep(d Duration)  After(d Duration) <-chan Time  Tick(d Duration) <-chan Time  NewTimer(d Duration) *Timer  NewTicker(d Duration) *Ticker  Parse(layout, value string) (Time, error)  Duration  Time  Second  Millisecond  Microsecond  Nanosecond  Minute  Hour  RFC3339  Unix(sec int64, nsec int64) Time  Date(year int, month Month, day, hour, min, sec, nsec int, loc *Location) Time  UTC'),
      sync: list('WaitGroup  Mutex  RWMutex  Once  Map  Pool  Cond  NewCond(l Locker) *Cond  OnceFunc(f func()) func()'),
      atomic: list('AddInt64(addr *int64, delta int64) int64  AddInt32(addr *int32, delta int32) int32  LoadInt64(addr *int64) int64  StoreInt64(addr *int64, val int64)  Int64  Int32  Bool  Value  Pointer'),
      sort: list('Slice(x any, less func(i, j int) bool)  SliceStable(x any, less func(i, j int) bool)  Ints(x []int)  Strings(x []string)  Float64s(x []float64)  Sort(data Interface)  Search(n int, f func(int) bool) int  SearchInts(a []int, x int) int'),
      http: list('ListenAndServe(addr string, handler Handler) error  ListenAndServeTLS(addr, certFile, keyFile string, handler Handler) error  HandleFunc(pattern string, handler func(ResponseWriter, *Request))  Handle(pattern string, handler Handler)  Get(url string) (*Response, error)  Post(url, contentType string, body io.Reader) (*Response, error)  NewRequest(method, url string, body io.Reader) (*Request, error)  NewRequestWithContext(ctx context.Context, method, url string, body io.Reader) (*Request, error)  NewServeMux() *ServeMux  Error(w ResponseWriter, error string, code int)  NotFound(w ResponseWriter, r *Request)  Redirect(w ResponseWriter, r *Request, url string, code int)  FileServer(root FileSystem) Handler  StripPrefix(prefix string, h Handler) Handler  StatusOK  StatusCreated  StatusNoContent  StatusBadRequest  StatusUnauthorized  StatusForbidden  StatusNotFound  StatusInternalServerError  MethodGet  MethodPost  MethodPut  MethodDelete  ResponseWriter  Request  Client  Server  Handler  HandlerFunc  Cookie  DefaultClient'),
      json: list('Marshal(v any) ([]byte, error)  MarshalIndent(v any, prefix, indent string) ([]byte, error)  Unmarshal(data []byte, v any) error  NewEncoder(w io.Writer) *Encoder  NewDecoder(r io.Reader) *Decoder  Valid(data []byte) bool  RawMessage  Number'),
      context: list('Background() Context  TODO() Context  WithCancel(parent Context) (Context, CancelFunc)  WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)  WithDeadline(parent Context, d time.Time) (Context, CancelFunc)  WithValue(parent Context, key, val any) Context  Context  CancelFunc  Canceled  DeadlineExceeded  Cause(c Context) error'),
      io: list('Reader  Writer  Closer  ReadAll(r Reader) ([]byte, error)  Copy(dst Writer, src Reader) (int64, error)  EOF  Discard  MultiWriter(writers ...Writer) Writer  TeeReader(r Reader, w Writer) Reader  ReadFull(r Reader, buf []byte) (int, error)  WriteString(w Writer, s string) (int, error)'),
      bufio: list('NewReader(rd io.Reader) *Reader  NewScanner(r io.Reader) *Scanner  NewWriter(w io.Writer) *Writer  Scanner  ScanLines  ScanWords'),
      log: list('Println(v ...any)  Printf(format string, v ...any)  Print(v ...any)  Fatal(v ...any)  Fatalf(format string, v ...any)  Fatalln(v ...any)  Panic(v ...any)  Panicf(format string, v ...any)  New(out io.Writer, prefix string, flag int) *Logger  SetFlags(flag int)  SetPrefix(prefix string)  Lshortfile  LstdFlags'),
      slog: list('Info(msg string, args ...any)  Warn(msg string, args ...any)  Error(msg string, args ...any)  Debug(msg string, args ...any)  String(key, value string) Attr  Int(key string, value int) Attr  Any(key string, value any) Attr  New(h Handler) *Logger  With(args ...any) *Logger  NewJSONHandler(w io.Writer, opts *HandlerOptions) *JSONHandler  NewTextHandler(w io.Writer, opts *HandlerOptions) *TextHandler  SetDefault(l *Logger)'),
      math: list('Max(x, y float64) float64  Min(x, y float64) float64  Abs(x float64) float64  Sqrt(x float64) float64  Pow(x, y float64) float64  Floor(x float64) float64  Ceil(x float64) float64  Round(x float64) float64  Log(x float64) float64  MaxInt  MinInt  MaxInt32  MaxInt64  MaxFloat64  Pi  Inf(sign int) float64  IsNaN(f float64) bool  NaN() float64'),
      filepath: list('Join(elem ...string) string  Base(path string) string  Dir(path string) string  Ext(path string) string  Abs(path string) (string, error)  Walk(root string, fn WalkFunc) error  WalkDir(root string, fn fs.WalkDirFunc) error  Glob(pattern string) ([]string, error)  Rel(basepath, targpath string) (string, error)  Clean(path string) string  Split(path string) (dir, file string)  Separator'),
      testing: list('T  B  M  Short() bool  Verbose() bool  AllocsPerRun(runs int, f func()) float64'),
      regexp: list('MustCompile(str string) *Regexp  Compile(expr string) (*Regexp, error)  MatchString(pattern string, s string) (bool, error)  QuoteMeta(s string) string'),
      rand: list('Intn(n int) int  Int() int  Int63() int64  Float64() float64  Perm(n int) []int  Shuffle(n int, swap func(i, j int))  Seed(seed int64)  New(src Source) *Rand  NewSource(seed int64) Source'),
      slices: list('Contains(s S, v E) bool  Index(s S, v E) int  Sort(x S)  SortFunc(x S, cmp func(a, b E) int)  Reverse(s S)  Max(x S) E  Min(x S) E  Equal(s1, s2 S) bool  BinarySearch(x S, target E) (int, bool)  Clone(s S) S  Insert(s S, i int, v ...E) S  Delete(s S, i, j int) S'),
      maps: list('Keys(m M) iter.Seq[K]  Values(m M) iter.Seq[V]  Clone(m M) M  Copy(dst, src M)  Equal(m1, m2 M1) bool  DeleteFunc(m M, del func(K, V) bool)'),
      unicode: list('IsLetter(r rune) bool  IsDigit(r rune) bool  IsSpace(r rune) bool  IsUpper(r rune) bool  IsLower(r rune) bool  ToUpper(r rune) rune  ToLower(r rune) rune'),
      bytes: list('Buffer  NewBuffer(buf []byte) *Buffer  NewBufferString(s string) *Buffer  Contains(b, subslice []byte) bool  Equal(a, b []byte) bool  Split(s, sep []byte) [][]byte  TrimSpace(s []byte) []byte'),
      signal: list('Notify(c chan<- os.Signal, sig ...os.Signal)  NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc)  Stop(c chan<- os.Signal)'),
      exec: list('Command(name string, arg ...string) *Cmd  CommandContext(ctx context.Context, name string, arg ...string) *Cmd  LookPath(file string) (string, error)'),
    },
    types: {
      'strings.Builder': list('WriteString(s string) (int, error)  WriteByte(c byte) error  WriteRune(r rune) (int, error)  String() string  Len() int  Reset()  Grow(n int)'),
      'sync.WaitGroup': list('Add(delta int)  Done()  Wait()  Go(f func())'),
      'sync.Mutex': list('Lock()  Unlock()  TryLock() bool'),
      'sync.RWMutex': list('Lock()  Unlock()  RLock()  RUnlock()'),
      'sync.Once': list('Do(f func())'),
      'http.ResponseWriter': list('Header() Header  Write([]byte) (int, error)  WriteHeader(statusCode int)'),
      'http.Request': list('Method  URL  Header  Body  Context() context.Context  FormValue(key string) string  ParseForm() error  PathValue(name string) string  Cookie(name string) (*Cookie, error)  Form  Host  RemoteAddr  WithContext(ctx context.Context) *Request  UserAgent() string'),
      'http.Client': list('Do(req *Request) (*Response, error)  Get(url string) (*Response, error)  Post(url, contentType string, body io.Reader) (*Response, error)  Timeout'),
      'bufio.Scanner': list('Scan() bool  Text() string  Bytes() []byte  Err() error  Buffer(buf []byte, max int)  Split(split SplitFunc)'),
      'bufio.Reader': list('ReadString(delim byte) (string, error)  ReadLine() (line []byte, isPrefix bool, err error)  ReadByte() (byte, error)  ReadRune() (r rune, size int, err error)'),
      'time.Time': list('Format(layout string) string  Add(d Duration) Time  Sub(u Time) Duration  Unix() int64  UnixMilli() int64  Before(u Time) bool  After(u Time) bool  Equal(u Time) bool  Year() int  Month() Month  Day() int  IsZero() bool  Truncate(d Duration) Time  UTC() Time'),
      'time.Duration': list('Seconds() float64  Milliseconds() int64  Minutes() float64  Hours() float64  String() string'),
      'testing.T': list('Errorf(format string, args ...any)  Error(args ...any)  Fatalf(format string, args ...any)  Fatal(args ...any)  Log(args ...any)  Logf(format string, args ...any)  Run(name string, f func(t *T)) bool  Helper()  Skip(args ...any)  Cleanup(f func())  TempDir() string  Parallel()  Setenv(key, value string)  FailNow()'),
      'testing.B': list('N  ResetTimer()  StopTimer()  StartTimer()  ReportAllocs()  Run(name string, f func(b *B)) bool'),
      'exec.Cmd': list('Run() error  Output() ([]byte, error)  CombinedOutput() ([]byte, error)  Start() error  Wait() error  Dir  Env  Stdin  Stdout  Stderr'),
      'json.Decoder': list('Decode(v any) error  More() bool  DisallowUnknownFields()'),
      'json.Encoder': list('Encode(v any) error  SetIndent(prefix, indent string)'),
      'context.Context': list('Done() <-chan struct{}  Err() error  Value(key any) any  Deadline() (deadline time.Time, ok bool)'),
      'error': list('Error() string'),
      'regexp.Regexp': list('MatchString(s string) bool  FindString(s string) string  FindStringSubmatch(s string) []string  FindAllString(s string, n int) []string  ReplaceAllString(src, repl string) string'),
      'os.File': list('Close() error  Read(b []byte) (n int, err error)  Write(b []byte) (n int, err error)  WriteString(s string) (n int, err error)  Name() string  Stat() (FileInfo, error)  Sync() error'),
    },
    snippets: [
      ['main', 'func main() {\n\t$0\n}', 'func main'], ['func', 'func ${1:name}(${2}) ${3}{\n\t$0\n}', 'function'], ['method', 'func (${1:r} *${2:Type}) ${3:Name}(${4}) ${5}{\n\t$0\n}', 'method'],
      ['struct', 'type ${1:Name} struct {\n\t${2:Field} ${3:string}\n}', 'struct type'], ['interface', 'type ${1:Name} interface {\n\t${2:Method}(${3}) ${4}\n}', 'interface type'],
      ['iferr', 'if err != nil {\n\treturn ${1:err}\n}', 'if err != nil'], ['ife', 'if ${1:cond} {\n\t$0\n}', 'if'], ['for', 'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t$0\n}', 'for loop'],
      ['forr', 'for ${1:_}, ${2:v} := range ${3:items} {\n\t$0\n}', 'for range'], ['switch', 'switch ${1:expr} {\ncase ${2:value}:\n\t$0\ndefault:\n}', 'switch'],
      ['select', 'select {\ncase ${1:v} := <-${2:ch}:\n\t$0\ncase <-${3:ctx.Done()}:\n\treturn\n}', 'select'], ['go', 'go func() {\n\t$0\n}()', 'goroutine'], ['defer', 'defer func() {\n\t$0\n}()', 'defer func'],
      ['test', 'func Test${1:Name}(t *testing.T) {\n\t$0\n}', 'unit test'], ['tabletest', 'func Test${1:Name}(t *testing.T) {\n\ttests := []struct {\n\t\tname string\n\t\t${2:in} ${3:string}\n\t\twant ${4:string}\n\t}{\n\t\t{name: "${5:case}"},\n\t}\n\tfor _, tt := range tests {\n\t\tt.Run(tt.name, func(t *testing.T) {\n\t\t\t$0\n\t\t})\n\t}\n}', 'table-driven test'],
      ['bench', 'func Benchmark${1:Name}(b *testing.B) {\n\tfor i := 0; i < b.N; i++ {\n\t\t$0\n\t}\n}', 'benchmark'], ['handler', 'func ${1:handler}(w http.ResponseWriter, r *http.Request) {\n\t$0\n}', 'http handler'],
      ['fmtp', 'fmt.Println($0)', 'fmt.Println'], ['pkg', 'package ${1:main}', 'package'], ['imp', 'import (\n\t"${1:fmt}"\n)', 'import block'], ['errorf', 'fmt.Errorf("${1:message}: %w", ${2:err})', 'wrapped error'],
    ],
  };

  const JAVA = {
    keywords: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try var void volatile while record sealed permits yield true false null'.split(' '),
    types: 'String Object Integer Long Double Float Boolean Character Byte Short Number Math System Thread Runnable Callable Exception RuntimeException IllegalArgumentException IllegalStateException NullPointerException IOException List ArrayList LinkedList Map HashMap LinkedHashMap TreeMap Set HashSet LinkedHashSet TreeSet Queue Deque ArrayDeque PriorityQueue Collection Collections Arrays Objects Optional Stream Collectors StringBuilder Scanner Path Paths Files File LocalDate LocalDateTime Instant Duration UUID CompletableFuture ExecutorService Executors AtomicInteger AtomicLong ConcurrentHashMap Override Deprecated FunctionalInterface SuppressWarnings Iterator Iterable Comparable Comparator Function Supplier Consumer Predicate BiFunction'.split(' '),
    statics: {
      System: list('out  err  in  currentTimeMillis()  nanoTime()  exit(int status)  getenv(String name)  getProperty(String key)  lineSeparator()  arraycopy(Object src, int srcPos, Object dest, int destPos, int length)  identityHashCode(Object x)'),
      'System.out': list('println(Object x)  print(Object x)  printf(String format, Object... args)  format(String format, Object... args)  flush()'),
      Math: list('max(a, b)  min(a, b)  abs(a)  sqrt(double a)  pow(double a, double b)  floor(double a)  ceil(double a)  round(double a)  random()  floorMod(x, y)  PI  E  log(double a)  signum(double d)  hypot(double x, double y)'),
      String: list('valueOf(Object obj)  format(String format, Object... args)  join(CharSequence delimiter, CharSequence... elements)  copyValueOf(char[] data)  CASE_INSENSITIVE_ORDER'),
      Integer: list('parseInt(String s)  valueOf(int i)  toString(int i)  MAX_VALUE  MIN_VALUE  compare(int x, int y)  toBinaryString(int i)  toHexString(int i)  sum(int a, int b)  max(int a, int b)  min(int a, int b)'),
      Long: list('parseLong(String s)  valueOf(long l)  MAX_VALUE  MIN_VALUE  compare(long x, long y)'),
      Double: list('parseDouble(String s)  valueOf(double d)  compare(double d1, double d2)  isNaN(double v)  MAX_VALUE  MIN_VALUE'),
      Boolean: list('parseBoolean(String s)  valueOf(boolean b)  TRUE  FALSE'),
      Character: list('isDigit(char ch)  isLetter(char ch)  isLetterOrDigit(char ch)  isUpperCase(char ch)  isLowerCase(char ch)  isWhitespace(char ch)  toUpperCase(char ch)  toLowerCase(char ch)  getNumericValue(char ch)'),
      Arrays: list('asList(T... a)  toString(Object[] a)  deepToString(Object[] a)  sort(Object[] a)  fill(Object[] a, Object val)  copyOf(T[] original, int newLength)  copyOfRange(T[] original, int from, int to)  stream(T[] array)  equals(Object[] a, Object[] a2)  binarySearch(Object[] a, Object key)'),
      Collections: list('sort(List<T> list)  reverse(List<?> list)  shuffle(List<?> list)  unmodifiableList(List<? extends T> list)  emptyList()  singletonList(T o)  max(Collection<? extends T> coll)  min(Collection<? extends T> coll)  synchronizedList(List<T> list)'),
      Objects: list('equals(Object a, Object b)  hash(Object... values)  requireNonNull(T obj)  requireNonNullElse(T obj, T defaultObj)  isNull(Object obj)  nonNull(Object obj)  toString(Object o)'),
      Optional: list('of(T value)  ofNullable(T value)  empty()'),
      List: list('of(E... elements)  copyOf(Collection<? extends E> coll)'), Set: list('of(E... elements)  copyOf(Collection<? extends E> coll)'), Map: list('of(K k1, V v1)  entry(K k, V v)  ofEntries(Entry... entries)  copyOf(Map<? extends K, ? extends V> map)'),
      Stream: list('of(T... values)  iterate(T seed, UnaryOperator<T> f)  generate(Supplier<T> s)  empty()  concat(Stream a, Stream b)'),
      IntStream: list('range(int startInclusive, int endExclusive)  rangeClosed(int startInclusive, int endInclusive)  of(int... values)'),
      Collectors: list('toList()  toSet()  toMap(Function keyMapper, Function valueMapper)  joining(CharSequence delimiter)  groupingBy(Function classifier)  counting()  summingInt(ToIntFunction mapper)  partitioningBy(Predicate predicate)  averagingInt(ToIntFunction mapper)'),
      Files: list('readAllLines(Path path)  readString(Path path)  writeString(Path path, CharSequence csq)  exists(Path path)  createDirectories(Path dir)  delete(Path path)  list(Path dir)  walk(Path start)  lines(Path path)  copy(Path source, Path target)  move(Path source, Path target)'),
      Paths: list('get(String first, String... more)'), Path: list('of(String first, String... more)'),
      LocalDate: list('now()  of(int year, int month, int dayOfMonth)  parse(CharSequence text)'), LocalDateTime: list('now()  of(int year, int month, int dayOfMonth, int hour, int minute)  parse(CharSequence text)'),
      Instant: list('now()  ofEpochMilli(long epochMilli)  parse(CharSequence text)'), Duration: list('between(Temporal start, Temporal end)  ofSeconds(long seconds)  ofMillis(long millis)  ofMinutes(long minutes)'),
      UUID: list('randomUUID()  fromString(String name)'), Thread: list('sleep(long millis)  currentThread()  ofVirtual()  startVirtualThread(Runnable task)'),
      Executors: list('newFixedThreadPool(int nThreads)  newCachedThreadPool()  newSingleThreadExecutor()  newVirtualThreadPerTaskExecutor()  newScheduledThreadPool(int corePoolSize)'),
      CompletableFuture: list('supplyAsync(Supplier<U> supplier)  runAsync(Runnable runnable)  allOf(CompletableFuture<?>... cfs)  completedFuture(U value)'),
      Comparator: list('comparing(Function keyExtractor)  comparingInt(ToIntFunction keyExtractor)  naturalOrder()  reverseOrder()'),
    },
    instance: {
      Object: list('equals(Object obj)  hashCode()  toString()  getClass()'),
      String: list('length()  charAt(int index)  substring(int beginIndex)  indexOf(String str)  lastIndexOf(String str)  contains(CharSequence s)  equals(Object o)  equalsIgnoreCase(String s)  isEmpty()  isBlank()  trim()  strip()  split(String regex)  replace(CharSequence target, CharSequence replacement)  replaceAll(String regex, String replacement)  toLowerCase()  toUpperCase()  startsWith(String prefix)  endsWith(String suffix)  toCharArray()  chars()  lines()  repeat(int count)  matches(String regex)  compareTo(String other)  getBytes()  formatted(Object... args)  concat(String str)'),
      StringBuilder: list('append(Object o)  insert(int offset, Object o)  reverse()  toString()  length()  setLength(int n)  deleteCharAt(int index)  delete(int start, int end)  charAt(int index)  indexOf(String str)  isEmpty()'),
      List: list('add(E e)  add(int index, E e)  addAll(Collection<? extends E> c)  get(int index)  set(int index, E e)  remove(int index)  remove(Object o)  size()  isEmpty()  contains(Object o)  indexOf(Object o)  clear()  stream()  forEach(Consumer<? super E> action)  sort(Comparator<? super E> c)  subList(int from, int to)  iterator()  toArray()  removeIf(Predicate<? super E> filter)  getFirst()  getLast()  reversed()'),
      Map: list('put(K key, V value)  get(Object key)  getOrDefault(Object key, V defaultValue)  containsKey(Object key)  containsValue(Object value)  remove(Object key)  size()  isEmpty()  keySet()  values()  entrySet()  putIfAbsent(K key, V value)  computeIfAbsent(K key, Function mappingFunction)  computeIfPresent(K key, BiFunction remappingFunction)  merge(K key, V value, BiFunction remappingFunction)  forEach(BiConsumer<? super K, ? super V> action)  clear()  putAll(Map<? extends K, ? extends V> m)'),
      Set: list('add(E e)  addAll(Collection<? extends E> c)  remove(Object o)  contains(Object o)  size()  isEmpty()  clear()  stream()  iterator()  retainAll(Collection<?> c)  removeIf(Predicate<? super E> filter)'),
      Optional: list('isPresent()  isEmpty()  get()  orElse(T other)  orElseGet(Supplier<? extends T> supplier)  orElseThrow()  map(Function<? super T, ? extends U> mapper)  flatMap(Function mapper)  filter(Predicate<? super T> predicate)  ifPresent(Consumer<? super T> action)  ifPresentOrElse(Consumer action, Runnable emptyAction)'),
      Stream: list('map(Function<? super T, ? extends R> mapper)  filter(Predicate<? super T> predicate)  collect(Collector collector)  forEach(Consumer<? super T> action)  toList()  sorted()  distinct()  limit(long maxSize)  skip(long n)  reduce(T identity, BinaryOperator<T> accumulator)  count()  anyMatch(Predicate<? super T> predicate)  allMatch(Predicate<? super T> predicate)  noneMatch(Predicate<? super T> predicate)  findFirst()  findAny()  flatMap(Function mapper)  mapToInt(ToIntFunction mapper)  peek(Consumer<? super T> action)  min(Comparator<? super T> comparator)  max(Comparator<? super T> comparator)'),
      Scanner: list('nextLine()  next()  nextInt()  nextDouble()  hasNext()  hasNextLine()  hasNextInt()  close()'),
      Path: list('getFileName()  getParent()  resolve(String other)  toAbsolutePath()  toFile()  toString()  normalize()  relativize(Path other)  startsWith(String other)'),
      File: list('exists()  getName()  getPath()  getAbsolutePath()  isDirectory()  isFile()  listFiles()  mkdirs()  delete()  length()  toPath()'),
      Thread: list('start()  join()  interrupt()  isAlive()  getName()  setDaemon(boolean on)  isInterrupted()'),
      ExecutorService: list('submit(Callable<T> task)  execute(Runnable command)  shutdown()  shutdownNow()  awaitTermination(long timeout, TimeUnit unit)  invokeAll(Collection tasks)  close()'),
      CompletableFuture: list('thenApply(Function fn)  thenAccept(Consumer action)  thenCompose(Function fn)  thenCombine(CompletionStage other, BiFunction fn)  exceptionally(Function fn)  join()  get()  complete(T value)  handle(BiFunction fn)'),
      Integer: list('intValue()  longValue()  doubleValue()  compareTo(Integer other)'),
      Iterator: list('hasNext()  next()  remove()'),
      Exception: list('getMessage()  getCause()  printStackTrace()  getStackTrace()  toString()  addSuppressed(Throwable exception)'),
      LocalDate: list('plusDays(long days)  minusDays(long days)  getYear()  getMonthValue()  getDayOfMonth()  isBefore(ChronoLocalDate other)  isAfter(ChronoLocalDate other)  format(DateTimeFormatter formatter)  getDayOfWeek()'),
    },
    alias: { ArrayList: 'List', LinkedList: 'List', Collection: 'List', Iterable: 'List', HashMap: 'Map', TreeMap: 'Map', LinkedHashMap: 'Map', ConcurrentHashMap: 'Map', HashSet: 'Set', TreeSet: 'Set', LinkedHashSet: 'Set', IOException: 'Exception', RuntimeException: 'Exception', IllegalArgumentException: 'Exception', IllegalStateException: 'Exception', Throwable: 'Exception', Error: 'Exception', IntStream: 'Stream', Long: 'Integer', Double: 'Integer', StringBuffer: 'StringBuilder', CharSequence: 'String', LocalDateTime: 'LocalDate' },
    snippets: [
      ['main', 'public static void main(String[] args) {\n\t$0\n}', 'main method'], ['sout', 'System.out.println($0);', 'System.out.println'], ['souf', 'System.out.printf("${1:%s}%n", ${2:value});', 'System.out.printf'], ['serr', 'System.err.println($0);', 'System.err.println'],
      ['class', 'public class ${1:${TM_FILENAME_BASE}} {\n\t$0\n}', 'class'], ['interface', 'public interface ${1:Name} {\n\t$0\n}', 'interface'], ['enum', 'public enum ${1:Name} {\n\t${2:A}, ${3:B}\n}', 'enum'], ['record', 'public record ${1:Name}(${2:String name}) {\n}', 'record'],
      ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for loop'], ['foreach', 'for (${1:var} ${2:item} : ${3:items}) {\n\t$0\n}', 'enhanced for'], ['while', 'while (${1:cond}) {\n\t$0\n}', 'while'],
      ['if', 'if (${1:cond}) {\n\t$0\n}', 'if'], ['ifelse', 'if (${1:cond}) {\n\t$2\n} else {\n\t$0\n}', 'if / else'], ['switch', 'switch (${1:value}) {\n\tcase ${2:X} -> $0;\n\tdefault -> {}\n}', 'switch'],
      ['try', 'try {\n\t$0\n} catch (${1:Exception} e) {\n\t${2:throw new RuntimeException(e);}\n}', 'try / catch'], ['tryr', 'try (${1:var r = open()}) {\n\t$0\n}', 'try-with-resources'], ['finally', 'try {\n\t$0\n} finally {\n\t\n}', 'try / finally'],
      ['test', '@Test\nvoid ${1:name}() {\n\t$0\n}', 'JUnit test'], ['getter', 'public ${1:String} get${2:Name}() {\n\treturn ${3:name};\n}', 'getter'], ['setter', 'public void set${1:Name}(${2:String} ${3:name}) {\n\tthis.${3:name} = ${3:name};\n}', 'setter'],
      ['ctor', 'public ${1:${TM_FILENAME_BASE}}(${2}) {\n\t$0\n}', 'constructor'], ['list', 'List<${1:String}> ${2:items} = new ArrayList<>();', 'new List'], ['map', 'Map<${1:String}, ${2:String}> ${3:map} = new HashMap<>();', 'new Map'],
      ['stream', '${1:items}.stream()\n\t.filter(${2:x -> true})\n\t.map(${3:x -> x})\n\t.collect(Collectors.toList());', 'stream pipeline'], ['lambda', '(${1:x}) -> ${0}', 'lambda'], ['logger', 'private static final Logger LOG = Logger.getLogger(${1:${TM_FILENAME_BASE}}.class.getName());', 'logger'],
      ['psvm', 'public static void main(String[] args) {\n\t$0\n}', 'main method'], ['imp', 'import ${1:java.util.*};', 'import'], ['pkg', 'package ${1:com.example};', 'package'],
    ],
  };

  const LANGS = { go: GO, java: JAVA };
  const SYMBOLS = {
    go: [[/^func\s+\(\s*\w+\s+\*?(\w+)[^)]*\)\s*(\w+)/, 'method', 2], [/^func\s+(\w+)/, 'function', 1], [/^type\s+(\w+)\s+struct\b/, 'struct', 1], [/^type\s+(\w+)\s+interface\b/, 'interface', 1], [/^type\s+(\w+)/, 'class', 1], [/^(?:var|const)\s+(\w+)/, 'variable', 1]],
    java: [[/\b(?:class|record)\s+(\w+)/, 'class', 1], [/\binterface\s+(\w+)/, 'interface', 1], [/\benum\s+(\w+)/, 'enum', 1],
      [/^\s*(?:(?:public|protected|private|static|final|abstract|synchronized|default|native)\s+)*(?:<[^>]+>\s+)?[\w<>\[\],.? ]+?\s+(\w+)\s*\([^;{)]*\)?[^;{]*\{?\s*$/, 'method', 1]],
  };
  const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'new', 'throw', 'synchronized', 'try', 'do']);

  function setup(monaco, dirOf) {
    const providers = {};
    const L = monaco.languages; const K = L.CompletionItemKind; const SK = L.SymbolKind;
    const kindOf = { function: K.Function, method: K.Method, type: K.Class, class: K.Class, struct: K.Struct, interface: K.Interface, enum: K.Enum, variable: K.Variable, const: K.Constant };

    // ---- JavaScript / TypeScript: Monaco's own service, configured for plain Node projects ----
    const ts = L.typescript;
    const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs, allowNonTsExtensions: true, allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, lib: ['esnext', 'dom', 'dom.iterable'], esModuleInterop: true, allowSyntheticDefaultImports: true, noEmit: true };
    for (const d of [ts.javascriptDefaults, ts.typescriptDefaults]) { d.setCompilerOptions(options); d.setEagerModelSync(true); }
    ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [2307, 2580, 2591, 7016] });
    const nodeTypes = `declare var require: { (id: string): any; resolve(id: string): string }; declare var module: { exports: any }; declare var exports: any; declare var __dirname: string; declare var __filename: string;
      declare var process: { env: { [k: string]: string | undefined }; argv: string[]; cwd(): string; exit(code?: number): never; platform: string; pid: number; version: string; versions: { [k: string]: string }; on(event: string, cb: (...a: any[]) => void): void; nextTick(cb: () => void): void; stdout: { write(s: string): boolean }; stderr: { write(s: string): boolean }; hrtime: { bigint(): bigint }; memoryUsage(): { rss: number; heapUsed: number; heapTotal: number } };
      declare var Buffer: { from(data: any, enc?: string): any; alloc(n: number): any; concat(list: any[]): any; isBuffer(x: any): boolean }; declare function setImmediate(cb: () => void): any;`;
    ts.javascriptDefaults.addExtraLib(nodeTypes, 'ts:hearth/node.d.ts'); ts.typescriptDefaults.addExtraLib(nodeTypes, 'ts:hearth/node.d.ts');

    // ---- Java / Go ----
    const wordsOf = (model, skip) => {
      const seen = new Map();
      for (const m of model.getValue().matchAll(/[A-Za-z_]\w{2,}/g)) { if (m[0] !== skip && !seen.has(m[0]) && seen.size < 4000) seen.set(m[0], true); }
      return [...seen.keys()];
    };
    const fnItem = (e, range, kind, detail) => ({ label: { label: e.name, detail: e.sig || '', description: detail }, kind: e.sig === null ? K.Field : kind, insertText: e.sig === null ? e.name : e.name + (/^\(\s*\)/.test(e.sig) ? '()' : '($0)'), insertTextRules: L.CompletionItemInsertTextRule.InsertAsSnippet, range, sortText: '1' + e.name });

    /** Type of a variable from its declaration in the same file (no compiler: a heuristic that is right most of the time). */
    function typeOfVar(lang, text, name) {
      const esc = name.replace(/\W/g, '');
      if (lang === 'java') { const m = text.match(new RegExp(`\\b([A-Z]\\w*)(?:<[^;=()]*>)?(?:\\[\\])?\\s+${esc}\\s*[=;,):]`)); return m && m[1]; }
      const patterns = [new RegExp(`\\b${esc}\\s+\\*?([a-z]\\w*\\.[A-Z]\\w*)`), new RegExp(`\\b${esc}\\s*:?=\\s*&?([a-z]\\w*\\.[A-Z]\\w*)\\{`), new RegExp(`\\bvar\\s+${esc}\\s+\\*?(error)\\b`), new RegExp(`\\b${esc}\\s*:?=\\s*([a-z]\\w*)\\.New(\\w+)\\(`)];
      for (const [i, re] of patterns.entries()) {
        const m = text.match(re); if (!m) continue;
        if (i === 3) { const guess = `${m[1]}.${m[2]}`; return GO.types[guess] ? guess : null; }
        return m[1];
      }
      if (/\berr\b/.test(esc) && esc === 'err') return 'error';
      return null;
    }

    function members(lang, model, qualifier, text) {
      const D = LANGS[lang];
      if (lang === 'go') {
        if (D.packages[qualifier] && new RegExp(`"(?:[\\w./-]+/)?${qualifier}"`).test(text)) return D.packages[qualifier];
        if (D.packages[qualifier] && !/^\s*import\b/m.test(text)) return D.packages[qualifier];
        const ty = typeOfVar('go', text, qualifier);
        return (ty && D.types[ty]) || (D.packages[qualifier] || null);
      }
      if (D.statics[qualifier]) return D.statics[qualifier];
      const ty = typeOfVar('java', text, qualifier);
      if (ty) return D.instance[ty] || D.instance[D.alias[ty]] || D.instance.Object;
      return null;
    }

    for (const lang of ['go', 'java']) {
      const D = LANGS[lang];
      L.registerCompletionItemProvider(lang, providers[lang] = {
        triggerCharacters: ['.'],
        async provideCompletionItems(model, position) {
          const w = model.getWordUntilPosition(position);
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
          const before = model.getLineContent(position.lineNumber).slice(0, w.startColumn - 1);
          const text = model.getValue();
          const q = before.match(/([\w.]*\w)\.$/);
          if (q) {
            const m = members(lang, model, q[1], text);
            return { suggestions: (m || []).map((e) => fnItem(e, range, K.Method, lang === 'go' ? q[1] : '')) };
          }
          const out = []; const seen = new Set();
          const add = (item) => { const key = typeof item.label === 'string' ? item.label : item.label.label; if (!seen.has(key)) { seen.add(key); out.push(item); } };
          for (const [prefix, body, doc] of D.snippets) add({ label: prefix, kind: K.Snippet, insertText: body, insertTextRules: L.CompletionItemInsertTextRule.InsertAsSnippet, detail: doc, documentation: { value: '```\n' + body.replace(/\$\{\d+:?([^}]*)\}|\$\d/g, '$1') + '\n```' }, range, sortText: '0' + prefix });
          for (const kw of D.keywords) add({ label: kw, kind: K.Keyword, insertText: kw, range, sortText: '2' + kw });
          for (const ty of (lang === 'go' ? D.typeNames : D.types)) add({ label: ty, kind: K.Class, insertText: ty, range, sortText: '3' + ty });
          if (lang === 'go') {
            for (const e of D.builtins) add(fnItem(e, range, K.Function, 'builtin'));
            for (const p of Object.keys(D.packages)) add({ label: p, kind: K.Module, insertText: p, range, sortText: '3' + p });
          } else for (const ty of Object.keys(D.statics)) add({ label: ty, kind: K.Class, insertText: ty, range, sortText: '3' + ty });
          for (const [name, kind] of docSymbols(lang, model).map((s) => [s.name, s.kind])) add({ label: name, kind: kindOf[kind] || K.Variable, insertText: name, detail: 'this file', range, sortText: '1' + name });
          for (const word of wordsOf(model, w.word)) add({ label: word, kind: K.Text, insertText: word, range, sortText: '9' + word });
          const dir = dirOf();
          if (dir && w.word.length >= 2) {
            try { for (const s of await window.hearth.search.symbols(dir, w.word)) add({ label: s.name, kind: kindOf[s.kind] || K.Variable, insertText: s.name, detail: s.file ? s.file.split(/[\\/]/).pop() : '', range, sortText: '1' + s.name }); } catch { /* no index */ }
          }
          return { suggestions: out };
        },
      });

      L.registerHoverProvider(lang, {
        async provideHover(model, position) {
          const w = model.getWordAtPosition(position); if (!w) return null;
          const own = docSymbols(lang, model).find((s) => s.name === w.word && s.line !== position.lineNumber);
          if (own) return { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), contents: [{ value: '```' + lang + '\n' + model.getLineContent(own.line).trim().replace(/\s*\{$/, '') + '\n```' }, { value: `${own.kind} - line ${own.line}` }] };
          const own2 = docSymbols(lang, model).find((s) => s.name === w.word);
          if (own2 && own2.line === position.lineNumber) return { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), contents: [{ value: `${own2.kind} ${w.word}` }] };
          const all = lang === 'go' ? Object.values(GO.packages).flat() : Object.values(JAVA.statics).flat().concat(Object.values(JAVA.instance).flat());
          const std = all.find((e) => e.name === w.word && e.sig !== null);
          if (std) return { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), contents: [{ value: '```' + lang + '\n' + std.name + std.sig + '\n```' }] };
          const dir = dirOf();
          if (dir) { try { const s = (await window.hearth.search.symbols(dir, w.word)).find((x) => x.name === w.word); if (s) return { contents: [{ value: `${s.kind} **${s.name}**` }, { value: `${s.file.split(/[\\/]/).pop()}:${s.line}  (F12: go to definition)` }] }; } catch { /* no index */ } }
          return null;
        },
      });

      L.registerDocumentSymbolProvider(lang, {
        provideDocumentSymbols: (model) => docSymbols(lang, model).map((s) => ({ name: s.name, detail: '', kind: SK[{ class: 'Class', struct: 'Struct', interface: 'Interface', enum: 'Enum', method: 'Method', function: 'Function', variable: 'Variable' }[s.kind]] ?? SK.Variable, tags: [],
          range: new monaco.Range(s.line, 1, s.line, model.getLineMaxColumn(s.line)), selectionRange: new monaco.Range(s.line, 1, s.line, model.getLineMaxColumn(s.line)) })),
      });
    }

    function docSymbols(lang, model) {
      const out = []; const lines = model.getLinesContent();
      for (let i = 0; i < lines.length && i < 20000; i++) {
        const line = lines[i];
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        for (const [re, kind, group] of SYMBOLS[lang]) {
          const m = line.match(re);
          if (m && !NOT_METHODS.has(m[group])) { out.push({ name: m[group], kind, line: i + 1 }); break; }
        }
      }
      return out;
    }
    return { docSymbols, providers };
  }

  window.EditorLang = { setup, GO, JAVA };
})();
