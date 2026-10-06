"use strict";
/* AdMob 수익엔진 (monetize 단계) — 네이티브(Capacitor)에서만 동작, 웹/로컬은 전부 무동작.
 *   • 전면광고: 며칠마다 하루 전환 시 (과노출 방지 = 별점 테러 방지)
 *   • 보상형:   정산 "광고 보고 일당 2배"
 * 실제 단위 ID는 AdMob 콘솔 발급 후 REAL 채우고 USE_TEST=false. 지금은 Google 공식 테스트 ID.
 *
 * ★ 배치 원칙 (2026-08-03 교정 — 사장님 확정): 전면광고는 **하루 경계에서만**.
 *   구 주석("매출 70%가 스플래시 직후 전면광고")은 폐기한다 — 앱 실행 직후·튜토리얼 중
 *   전면광고는 D0 이탈을 폭증시키고, 첫 광고를 60~90초 뒤로 미루면 D1 이 5~8%p 오른다.
 *   세션당 3개 미만이면 장기 리텐션이 27% 높다. 수익은 전면이 아니라 **보상형 지점 수**에서
 *   나온다(건전 기준 imp/DAU 2~6 · 옵트인 40~70%).
 *   근거·지점 설계 = core/concepts/jjimjilbang-CONCEPT.md §수익엔진.
 */
const ADS = (function () {
  // Google 공식 테스트 광고 단위 (실제 수익 X — 클릭해도 안전). 콘솔 발급 ID로 교체 전까지 사용.
  const TEST = {
    interstitial: { android: "ca-app-pub-3940256099942544/1033173712", ios: "ca-app-pub-3940256099942544/4411468910" },
    rewarded:     { android: "ca-app-pub-3940256099942544/5224354917", ios: "ca-app-pub-3940256099942544/1712485313" },
  };
  // ▼ AdMob 콘솔 발급 실제 광고 단위 ID (jjs01hwang AdMob).
  //   Android App ID ca-app-pub-6403397417096706~6229269528 / iOS App ID ca-app-pub-6403397417096706~5092652959(app/admob.config.json).
  //   양 플랫폼 전면+보상형 실 단위ID 채움(2026-06-17). 안전장치(아래 unit): 실ID 비면 광고 미표시(테스트광고 프로덕션 노출 방지).
  /* 찜질방 AdMob (jjs01hwang). App ID = app/admob.config.json
     Android ca-app-pub-6403397417096706~1184986470 / iOS ca-app-pub-6403397417096706~4330024562
     ★ 보상형은 아직 없다 — AdMob 콘솔의 Rewarded 폼이 다음 단계로 안 넘어가 만들지 못했다.
       비어 있으면 unit() 이 null 을 돌려주고 광고를 **안 띄운다**(테스트광고가 프로덕션에 나가는
       사고를 막는 안전장치). 다음 회차에 채운다. */
  const REAL = {
    interstitial: { android: "ca-app-pub-6403397417096706/2740896716", ios: "ca-app-pub-6403397417096706/9988831344" },
    rewarded:     { android: "", ios: "" },
  };
  const USE_TEST = false;           // 실제 광고 단위 사용. ⚠️ 본인 라이브 광고 클릭 금지(무효 트래픽=계정 정지). 기기 테스트는 AdMob에 테스트기기 등록.
  const INTERSTITIAL_EVERY_N_DAYS = 3;   // 며칠마다 전면광고 (1=매일, 0=끔)

  let plugin = null, platform = "web", ready = false, interstitialReady = false;

  function detect() {
    try {
      const C = window.Capacitor;
      if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.AdMob) {
        plugin = C.Plugins.AdMob;
        platform = (C.getPlatform && C.getPlatform()) || "android";
        return true;
      }
    } catch (e) {}
    return false;
  }
  // 실 단위ID 우선, 없으면: 테스트모드면 테스트ID / 프로덕션이면 null(광고 미표시 — 테스트광고 프로덕션 노출 방지)
  function unit(kind) {
    const key = platform === "ios" ? "ios" : "android";
    if (USE_TEST) return TEST[kind][key];
    return (REAL[kind] && REAL[kind][key]) || null;
  }
  // ★ npa:true = 비맞춤(non-personalized) 광고 요청. ATT 프롬프트를 안 띄우는 정책과 한 쌍이다
  //   (inject-admob.js 가 NSUserTrackingUsageDescription 을 지운다). 이게 빠지면 앱은 맞춤 광고를
  //   요청하면서 개인정보 라벨엔 '추적 안 함'을 적게 돼 신고가 사실과 어긋난다.
  function opts(kind) { const adId = unit(kind); return adId ? { adId, isTesting: USE_TEST, npa: true } : null; }

  async function init() {
    if (!detect()) return;          // 웹/로컬 → 조용히 무동작
    try {
      // ★ ATT(추적 동의)를 부르지 않는다 — 우리는 IDFA 를 안 쓰고 비맞춤 광고만 요청한다(opts npa:true).
      //   inject-admob.js 가 NSUserTrackingUsageDescription 을 지우므로 이 호출은 프롬프트도 못 띄우고,
      //   '추적 선언 O + 프롬프트 X' 로 읽혀 거부 사유가 된다. 개인정보 라벨의 '추적 안 함'과 한 쌍.
      await plugin.initialize();
      ready = true; preloadInterstitial();
    } catch (e) { console.warn("[ads] init 실패", e); }
  }
  async function preloadInterstitial() {
    if (!ready) return;
    const o = opts("interstitial"); if (!o) return;   // 실 단위ID 없으면 스킵
    try { await plugin.prepareInterstitial(o); interstitialReady = true; }
    catch (e) { interstitialReady = false; }
  }
  // 전면광고 — 흐름을 막지 않게 항상 resolve. 안 떠도 게임은 그대로 진행.
  async function showInterstitial() {
    if (!ready) return false;
    const o = opts("interstitial"); if (!o) return false;   // 실 단위ID 없으면 광고 안 띄움
    try {
      if (!interstitialReady) await plugin.prepareInterstitial(o);
      await plugin.showInterstitial();
      if (typeof DGL !== "undefined") DGL.track("ad_interstitial", {});   // 수익 이벤트
      interstitialReady = false; preloadInterstitial();   // 다음 광고 미리 로드
      return true;
    } catch (e) { console.warn("[ads] interstitial", e); preloadInterstitial(); return false; }
  }
  // 하루 전환 시 며칠마다 한 번만 (day = 전환 후 새 날 번호)
  async function dayTransition(day) {
    if (!ready || INTERSTITIAL_EVERY_N_DAYS <= 0) return;
    if (day > 0 && day % INTERSTITIAL_EVERY_N_DAYS === 0) await showInterstitial();
  }
  // 보상형 — 끝까지 시청하면 true(보상 지급). 웹·취소·실패는 false(보상 없음, 정책 준수).
  async function showRewarded() {
    if (!ready) return false;
    const o = opts("rewarded"); if (!o) return false;   // 실 단위ID 없으면 보상형 비활성
    try {
      await plugin.prepareRewardVideoAd(o);
      const item = await plugin.showRewardVideoAd();   // 시청 완료 시 보상 아이템으로 resolve
      if (typeof DGL !== "undefined") DGL.track("ad_rewarded", { result: item ? "watched" : "skipped" });   // 수익 이벤트
      return !!item;
    } catch (e) { console.warn("[ads] rewarded", e); return false; }
  }
  return {
    init,
    available: () => ready && !!unit("rewarded"),   // 보상형 단위ID 있을 때만 true → 웹/실ID없음에선 '2배' 버튼 숨김(죽은 버튼 방지)
    showInterstitial, dayTransition, showRewarded,
  };
})();
