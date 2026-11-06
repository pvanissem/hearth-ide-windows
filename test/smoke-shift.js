// Quick probe: does Shift Shift open Search Everywhere, also with the editor and the usages panel open?
// (run with scripts/smoke-one.ps1)
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  await wait(1500);
  const d = document.querySelector('#dlg-search');
  const press = () => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
  press(); await wait(120); press(); await wait(300);
  r.afterTwoShifts = d.open;
  d.close();
  press(); await wait(700); press(); await wait(300);
  r.slowPressesStayClosed = !d.open;
  d.open && d.close();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); await wait(300);
  r.ctrlK = d.open;
  d.close();

  // with the editor and usages panel, like in the full run
  const file = REPO_FILE;
  await openFile(file); await wait(1200);
  document.dispatchEvent(new CustomEvent('hearth:usages', { detail: { word: 'toWslPath', file } }));
  await wait(1500);
  r.usagesShown = !document.querySelector('#usages').hidden;
  document.querySelector('#usages-close').click();
  r.usagesClosed = document.querySelector('#usages').hidden;
  press(); await wait(120); press(); await wait(300);
  r.afterEditorShifts = d.open;
  return r;
})()
