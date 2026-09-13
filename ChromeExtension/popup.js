const defaults = { enabled: true, citationFormat: true };
const enabled = document.querySelector("#enabled");
const citationFormat = document.querySelector("#citationFormat");
const status = document.querySelector("#status");

initialize();

async function initialize() {
  const settings = await chrome.storage.local.get(defaults);
  enabled.checked = settings.enabled;
  citationFormat.checked = settings.citationFormat;
}

enabled.addEventListener("change", save);
citationFormat.addEventListener("change", save);

async function save() {
  await chrome.storage.local.set({
    enabled: enabled.checked,
    citationFormat: citationFormat.checked,
  });
  status.textContent = "已儲存。";
  setTimeout(() => {
    status.textContent = "設定會自動儲存。";
  }, 1200);
}
