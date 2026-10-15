"use client";

// 发音走浏览器自带的 Web Speech API，不下载任何音频文件。
//
// 几个必须处理的坑：
//   1. getVoices() 在部分浏览器里是异步的，首次调用可能返回空数组，
//      要监听 voiceschanged 事件再取。所以这里惰性取、且缓存。
//   2. iOS Safari 要求「第一次朗读必须由用户手势触发」，否则静默失败。
//      所以不要在页面加载时自动朗读。
//   3. 连续点两次喇叭会排队读出两遍，读之前先 cancel。

export type Accent = "uk" | "us";

const LANG_BY_ACCENT: Record<Accent, string> = {
  uk: "en-GB",
  us: "en-US",
};

let cachedVoices: SpeechSynthesisVoice[] = [];

export function isSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function loadVoices(): SpeechSynthesisVoice[] {
  if (!isSupported()) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return cachedVoices;
}

/** 订阅一次 voices 就绪事件。返回取消订阅的函数。 */
export function onVoicesReady(cb: () => void): () => void {
  if (!isSupported()) return () => {};
  const handler = () => {
    loadVoices();
    cb();
  };
  window.speechSynthesis.addEventListener("voiceschanged", handler);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
}

export function pickVoice(accent: Accent): SpeechSynthesisVoice | undefined {
  const voices = loadVoices();
  if (!voices.length) return undefined;

  const want = LANG_BY_ACCENT[accent];
  // 优先精确匹配 en-GB / en-US，退而求其次找任意英文音色
  return (
    voices.find((v) => v.lang.replace("_", "-") === want) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(want.slice(0, 2))) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en"))
  );
}

export interface SpeakOptions {
  accent?: Accent;
  /** 0.1 ~ 10，默认 0.9——比正常语速稍慢，便于跟读 */
  rate?: number;
}

export function speak(text: string, options: SpeakOptions = {}): void {
  if (!isSupported() || !text.trim()) return;
  const { accent = "uk", rate = 0.9 } = options;

  // 先掐掉正在读的，避免连点排队
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(accent);
  if (voice) utter.voice = voice;
  utter.lang = LANG_BY_ACCENT[accent];
  utter.rate = rate;

  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (isSupported()) window.speechSynthesis.cancel();
}
