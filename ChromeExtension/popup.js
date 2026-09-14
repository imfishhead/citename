const defaults = { enabled: true, citationFormat: true, filenameFormat: null };
const enabled = document.querySelector("#enabled");
const filenameFormat = document.querySelector("#filenameFormat");
const formatHint = document.querySelector("#formatHint");
const filenamePreview = document.querySelector("#filenamePreview");
const status = document.querySelector("#status");
const formats = {
  "author-year-title": "作者 (年份) - 標題",
  "author-title": "作者 - 標題",
  "year-title": "(年份) - 標題",
  title: "只用標題",
};

initialize();

async function initialize() {
  const settings = await chrome.storage.local.get(defaults);
  enabled.checked = settings.enabled;
  filenameFormat.value = formats[settings.filenameFormat]
    ? settings.filenameFormat
    : settings.citationFormat ? "author-year-title" : "title";
  updatePreview();
}

enabled.addEventListener("change", save);
filenameFormat.addEventListener("change", save);

async function save() {
  await chrome.storage.local.set({
    enabled: enabled.checked,
    citationFormat: filenameFormat.value === "author-year-title",
    filenameFormat: filenameFormat.value,
  });
  updatePreview();
  status.textContent = "已儲存。";
  setTimeout(() => {
    status.textContent = "設定會自動儲存。";
  }, 1200);
}

function updatePreview() {
  const format = filenameFormat.value;
  const label = formats[format] || formats["author-year-title"];
  formatHint.textContent = label;
  filenamePreview.textContent = `${label}.pdf`;
}
