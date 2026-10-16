"use client";

// 发音走浏览器自带的 Web Speech API，不下载任何音频文件。
//
// 几个必须处理的坑：
//   1. getVoices() 是异步就绪的，首次调用可能返回空数组——所以每次朗读都重新
//      取一遍，不缓存空的（详见 loadVoices）。
//   2. iOS Safari 要求「第一次朗读必须由用户手势触发」，否则静默失败。
//      所以不要在页面加载时自动朗读。
//   3. 连续点两次喇叭会排队读出两遍，读之前先 cancel。
//   4. **音色要挑本地的**，云端音色每读一次走一趟网络，见 pickVoice。

export type Accent = "uk" | "us";

const LANG_BY_ACCENT: Record<Accent, string> = {
  uk: "en-GB",
  us: "en-US",
};

let cachedVoices: SpeechSynthesisVoice[] = [];

export function isSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * 取音色列表。
 *
 * `getVoices()` 是**异步就绪**的：实测（Chromium / Windows）页面加载后返回空数组、
 * 约 2.5 秒后才变成 6 个。曾经在这里挂过 `voiceschanged` 监听、也留过一个
 * `onVoicesReady` 给外部订阅，后来都删了——因为 `pickVoice()` 每次都会调到这里
 * 重新 `getVoices()`，音色一就绪就自动进缓存，不需要谁来通知。**唯一的残留影响
 * 是每个会话的第一张卡会退到浏览器默认音色**（那一瞬列表还是空的），而这不是
 * 监听能解决的：等 2.5 秒再读，比先用默认音色读出来差得多。
 */
function loadVoices(): SpeechSynthesisVoice[] {
  if (!isSupported()) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return cachedVoices;
}

/**
 * 挑音色，**本地音色优先**。
 *
 * `localService === false` 的意思是「这个音色由网络服务合成」——每读一次都要把
 * 文本发到服务商服务器、再把音频流收回来。Edge 在 Windows 上会带一批「在线
 * 自然语音」，听感确实更好，但代价是**每个词的起读都要等一趟网络往返**，表现
 * 就是「每个词都慢半拍」（用户 2026-10-16 报的，机器正是 Edge）。本地音色是
 * 系统自带的（Windows 上的 Microsoft Mark / David / Zira），起读实测约 130ms，
 * 稳且不依赖网络。
 *
 * 优先级：本地+口音精确 → 本地任意英文 → 在线+口音精确 → 在线任意英文。
 * 也就是**同口音里优先本地，实在没有本地英文音色才退到在线**。
 *
 * ⚠️ 已知代价：中文版 Windows 上常常根本没装本地英式音色，此时「英式」那一档
 * 会落到本地的**美式**音色上——口音不准，但不卡。反过来保留在线英式音色就等于
 * 每个词等网络。这里明确选了速度。用户若要求口音优先，改这里的顺序即可。
 */
export function pickVoice(accent: Accent): SpeechSynthesisVoice | undefined {
  const voices = loadVoices();
  if (!voices.length) return undefined;

  const want = LANG_BY_ACCENT[accent].toLowerCase();
  const langOf = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase();
  const english = voices.filter((v) => langOf(v).startsWith("en"));

  return (
    english.find((v) => langOf(v) === want && v.localService) ??
    english.find((v) => v.localService) ??
    english.find((v) => langOf(v) === want) ??
    english[0]
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

  const synth = window.speechSynthesis;

  // 只在**真的还有东西在念**时才取消。无条件的 cancel() 是 Chromium 系的老雷：
  // cancel 紧跟 speak 时，新的一次朗读可能被延后、甚至整条吞掉。没得取消时跳过
  // 这一步，就完全没有这个交互。
  if (synth.speaking || synth.pending) synth.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(accent);
  if (voice) utter.voice = voice;
  // lang 跟着**实际选中的音色**走，不用写死的口音值。两者打架没有意义：挑不到
  // 本地英式音色时会回退到美式，这时还声明 en-GB 只是自欺——引擎照样按音色合成。
  // 只有连一个英文音色都没有（voice 为 undefined）时，才退回按口音值兜底。
  utter.lang = voice ? voice.lang.replace("_", "-") : LANG_BY_ACCENT[accent];
  utter.rate = rate;

  synth.speak(utter);
}

export function stopSpeaking(): void {
  if (isSupported()) window.speechSynthesis.cancel();
}
