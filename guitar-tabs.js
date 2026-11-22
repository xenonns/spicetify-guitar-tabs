(async function GuitarTabsLoader() {
  const REMOTE_URL = "https://raw.githubusercontent.com/xenonns/spicetify-guitar-tabs/main/guitar-tabs.main.js";
  const CACHE_KEY = "spicetify-guitar-tabs:remote-bundle";
  let code = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(REMOTE_URL, { cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      code = await res.text();
      localStorage.setItem(CACHE_KEY, code);
    }
  } catch (_) {}

  if (!code) {
    code = localStorage.getItem(CACHE_KEY);
  }

  if (code) {
    (new Function(code))();
  }
})();
