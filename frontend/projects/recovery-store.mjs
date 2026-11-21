// One asynchronous recovery snapshot. No DOM, project rules or migration paths.
export function createRecoveryStore({factory = globalThis.indexedDB, name = "freeedit-recovery"} = {}) {
  let connection = null;
  let queue = Promise.resolve();
  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!factory) { reject(Error("IndexedDB is unavailable")); return; }
      const request = factory.open(name, 1);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(Error("Recovery storage did not open"));
      }, 5000);
      request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (expired) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    }).catch(error => { connection = null; throw error; });
    return connection;
  }
  function run(mode, action) {
    const pending = queue.then(async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("snapshots", mode);
        const timer = setTimeout(() => transaction.abort(), 5000);
        let result;
        transaction.oncomplete = () => { clearTimeout(timer); resolve(result); };
        transaction.onabort = transaction.onerror = () => {
          clearTimeout(timer);
          reject(transaction.error || Error("Recovery transaction failed"));
        };
        try {
          const request = action(transaction.objectStore("snapshots"));
          request.onsuccess = () => { result = request.result; };
        } catch (error) {
          clearTimeout(timer); transaction.abort(); reject(error);
        }
      });
    });
    queue = pending.catch(() => {});
    return pending;
  }
  return Object.freeze({
    read: () => run("readonly", store => store.get("current")),
    write(value) {
      const snapshot = structuredClone(value);
      return run("readwrite", store => store.put(snapshot, "current"));
    },
    clear: () => run("readwrite", store => store.delete("current")),
  });
}
