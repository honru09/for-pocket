import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteService, SESSION_KEY } from '../src/services.mjs';

function browserGlobals(t, fetcher) {
  const saved = new Map([[SESSION_KEY, 'fixture-session']]);
  for (const [name, value] of Object.entries({
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    document: { documentElement: { lang: 'en' } },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  t.mock.method(globalThis, 'fetch', fetcher);
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const entry = id => ({ id, ledgerId: 'ledger-original', amountMinor: 1200, currency: 'JPY' });

test('a failed file does not discard successful files or prevent later files from being analyzed', async t => {
  const requests = [];
  browserGlobals(t, async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    return body.file.name === 'broken.docx' ? response({ error: 'errorFileRead' }, 422) : response({ items: [entry(body.file.name)] });
  });
  const service = remoteService();
  const result = await service.aiParseExpense({ files: [new File(['photo'], 'first.png', { type: 'image/png' }), new File(['bad'], 'broken.docx', { type: 'application/octet-stream' }), new File(['bill'], 'last.pdf', { type: '' })], text: 'October expenses', ledgerId: 'ledger-original' });
  assert.deepEqual(result.items.map(item => item.id), ['first.png', 'last.pdf']);
  assert.deepEqual(result.items.map(item => item.sourceName), ['first.png', 'last.pdf']);
  assert.deepEqual(result.warnings, [{ code: 'errorFileRead', name: 'broken.docx' }]);
  assert.equal(requests[1].file.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(requests[2].file.mimeType, 'application/pdf');
  assert.equal(requests[0].text, 'October expenses');
  assert.equal(requests[1].text, '');
  assert.ok(requests.every(body => body.ledgerId === 'ledger-original'));
});

test('authentication or ledger changes abort multi-file analysis rather than exposing mixed-scope results', async t => {
  let calls = 0;
  browserGlobals(t, async () => { calls++; return calls === 1 ? response({ items: [entry('first')] }) : response({ error: 'errorLedgerChanged' }, 409); });
  await assert.rejects(remoteService().aiParseExpense({ files: ['first', 'stale', 'not-sent'].map(name => new File(['file'], `${name}.png`, { type: 'image/png' })), ledgerId: 'old-ledger' }), { message: 'errorLedgerChanged', status: 409 });
  assert.equal(calls, 2);
});

test('client text clipping is accompanied by a warning for both text-only and file requests', async t => {
  const requests = [];
  browserGlobals(t, async (url, options) => { requests.push(JSON.parse(options.body)); return response({ items: [entry('one')] }); });
  const service = remoteService();
  const longText = '日'.repeat(12001);
  const textResult = await service.aiParseExpense({ text: longText });
  assert.deepEqual(textResult.warnings, ['errorTextTooLong']);
  const fileResult = await service.aiParseExpense({ text: longText, files: [new File(['x'], 'bill.pdf', { type: 'application/pdf' })] });
  assert.deepEqual(fileResult.warnings, [{ code: 'errorTextTooLong', name: '' }]);
  assert.ok(requests.every(body => body.text.length === 12000));
});

test('partial batch failure returns only persisted records and stops before sending later batches', async t => {
  const batches = [];
  browserGlobals(t, async (url, options) => {
    const body = JSON.parse(options.body); batches.push(body);
    return batches.length === 1 ? response({ entries: body.entries }) : response({ error: 'errorSave' }, 500);
  });
  const entries = Array.from({ length: 130 }, (_, index) => entry(`record-${index}`));
  const result = await remoteService().importExpenses(entries);
  assert.equal(result.partial, true);
  assert.deepEqual(result.entries.map(item => item.id), entries.slice(0, 50).map(item => item.id));
  assert.deepEqual(result.warnings, ['errorSave']);
  assert.deepEqual(batches.map(body => body.entries.length), [50, 50]);
  assert.ok(batches.every(body => body.ledgerId === 'ledger-original'));
  assert.equal(entries.length, 130, 'remaining previews remain available for retry');
});

test('a failure in the first import batch rejects instead of claiming partial success', async t => {
  browserGlobals(t, async () => response({ error: 'errorSignIn' }, 401));
  await assert.rejects(remoteService().importExpenses([entry('first')]), { message: 'errorSignIn', status: 401 });
});

test('queued settings writes keep the explicitly captured ledger scope', async t => {
  const requests = [];
  browserGlobals(t, async (url, options) => { const body = options?.body ? JSON.parse(options.body) : {}; requests.push({ url, body }); return response({ ledgerId: url.endsWith('/settings') ? body.ledgerId : 'new-ledger' }); });
  const service = remoteService();
  await service.getProfile();
  await service.saveSettings({ currency: 'JPY', consumers: [] }, 'original-ledger');
  assert.equal(requests.at(-1).body.ledgerId, 'original-ledger');
  assert.equal(requests.at(-1).body.consumers, undefined);
});

for (const staleAction of ['settings', 'profile', 'google', 'link']) {
  test(`a delayed ${staleAction} response cannot replace the ledger selected by a newer circle switch`, async t => {
    const requests = [];
    let releaseOld, reportStarted;
    const blocked = new Promise(resolve => { releaseOld = resolve; });
    const started = new Promise(resolve => { reportStarted = resolve; });
    let profileReads = 0;
    browserGlobals(t, async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {};
      requests.push({ url, body });
      if (url === '/api/profile' && ++profileReads === 1) return response({ ledgerId: 'ledger-A' });
      const staleRoute = { settings: '/api/settings', profile: '/api/profile', google: '/api/auth/google', link: '/api/auth/link-verify' }[staleAction];
      if (url === staleRoute) {
        reportStarted(); await blocked;
        return response(staleAction === 'google' || staleAction === 'link' ? { profile: { ledgerId: 'ledger-A' } } : { ledgerId: 'ledger-A' });
      }
      if (url === '/api/circles/switch') return response({ ledgerId: 'ledger-B' });
      return response({ ok: true });
    });
    const service = remoteService();
    await service.getProfile();
    const late = {
      settings: () => service.saveSettings({ currency: 'JPY' }, 'ledger-A'),
      profile: () => service.getProfile(),
      google: () => service.loginWithGoogle('fixture-credential'),
      link: () => service.verifyLink({ code: 'fixture-code' }),
    }[staleAction]();
    await started;
    await service.switchCircle('circle-B');
    releaseOld(); await late;
    await service.deleteExpense('record-in-B');
    assert.equal(requests.at(-1).url, '/api/expenses/record-in-B?ledgerId=ledger-B');
    await service.addExpense({ id: 'fresh-record-in-B', amountMinor: 1200, currency: 'JPY' });
    assert.equal(requests.at(-1).body.ledgerId, 'ledger-B');
  });
}
