// AI assistant client for apps. Talks to the bridge's /v1/assistant endpoints.
// Questions can come from the car (ask) or from the phone companion page; `watch`
// delivers every new or updated item from either source.

export function createAi(net, car) {
  function ctx() {
    const g = car.get('gps');
    const speed = car.get('speed');
    let s = '';
    if (g.lat != null && g.lon != null) s += '&lat=' + g.lat.toFixed(4) + '&lon=' + g.lon.toFixed(4);
    if (speed != null) s += '&speed=' + Math.round(speed);
    return s;
  }

  return {
    /**
     * Ask a question. `cb(err, item)` fires once the question is accepted (status "pending");
     * the answer arrives through `watch`.
     */
    ask(question, cb) {
      net.get('/v1/assistant/ask?q=' + encodeURIComponent(question) + ctx(), { timeout: 10000 }, (err, item) => {
        if (cb) cb(err, item);
      });
    },

    /**
     * Poll the assistant feed. `fn(items)` receives new/updated items (oldest first).
     * Returns a stop function. Polling pauses automatically while offline.
     */
    watch(fn, intervalMs) {
      let since = 0;
      let stopped = false;
      let timer = null;
      let inflight = false;
      const tick = () => {
        if (stopped || inflight) return;
        if (!net.online()) { schedule(); return; }
        inflight = true;
        net.get('/v1/assistant/feed?since=' + since + ctx(), { timeout: 8000 }, (err, data) => {
          inflight = false;
          if (!err && data && data.items && data.items.length) {
            data.items.forEach((it) => { since = Math.max(since, it.updated || it.ts); });
            fn(data.items.slice().sort((a, b) => a.id - b.id));
          }
          schedule();
        });
      };
      const schedule = () => { if (!stopped) timer = setTimeout(tick, intervalMs || 2000); };
      tick();
      return () => { stopped = true; clearTimeout(timer); };
    },
  };
}
