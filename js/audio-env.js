"use strict";
/* Dumb Game Lab — 소리 환경 판정 (web-capacitor 공용 드롭인 · 의존성 0)
 *
 * ★★ 이 파일이 «로컬은 무음 · 배포는 유음» 의 SOT 다 (2026-08-30 사장님 지시:
 *    "내 컴퓨터 소리 키고 싶은데 게임들이 로컬에서 소리 뜨는 게 짜증난다 —
 *     글로벌로 끄고 배포 시에는 켜라").
 *
 * 소리를 내는 진입점은 **전부** 이 판정을 거친다 — splash.js(스튜디오 스플래시) ·
 * sound.js(바닐라 게임) · base 엔진 `render/audio.ts`. 한 곳이라도 빠지면
 * "음소거인데 스플래시만 소리남" 류의 구멍이 그대로 재발한다.
 * 게이트 = `core/tools/check-audio-env.mjs`
 *
 * ★ 그리고 **로컬에서는 안 물어본 코드까지 막는다**(아래 `hardMute`) — 스피커로 가는
 *   연결 자체를 끊는다. 배선을 빠뜨린 새 게임도 로컬에서는 조용하다.
 *
 * ── ★ 왜 «포트가 있어야 로컬» 인가 (이게 이 파일에서 제일 중요한 줄이다) ─────────
 * Capacitor 네이티브 웹뷰는 **localhost 로 서빙된다**(iOS `capacitor://localhost`,
 * Android `https://localhost`). 그래서 hostname 만 보고 "로컬이면 개발"이라고 짜면
 * **스토어에 나간 앱이 통째로 무음이 된다** — 되돌리려면 재심사다.
 * 같은 함정으로 실제 사고가 있었다(디버그 치트 패널·GA debug_mode 가 스토어 빌드에
 * 노출, PCAlba v1.0.8 에서 수정).
 * 로컬 개발 서버는 **예외 없이 포트가 붙는다**(8800 · 5173 · 4173 …). 네이티브 웹뷰는
 * 안 붙는다. 그래서 판정을 «http(s) + 로컬 호스트 + 포트 있음 + 네이티브 아님» 넷의
 * AND 로 조인다. 넷 다 맞아야 조용하다 — 애매하면 **소리를 낸다**(배포 쪽이 안전하다).
 *
 * ── 우선순위 (위가 이긴다) ────────────────────────────────────────────────
 *  1. `?mute=1` / `?mute=0`  — 링크 하나로 이번 회차만. 저장소를 안 건드린다.
 *  2. 로컬 개발 서버(또는 `file:`) → **무음. 예외 없다.** 게임 안 음소거 버튼으로도
 *     못 켠다 — 로컬에서 소리를 들을 유일한 길은 `?mute=0` 링크다.
 *  3. 이번 세션에 사람이 직접 토글한 값 (배포에서만 의미가 있다).
 *  4. 저장된 플레이어 설정.
 *
 * 쓰는 법:
 *   var saved = localStorage.getItem('dgl_mute') === '1';
 *   var muted = window.DGL_AUDIO ? window.DGL_AUDIO.muted(saved) : saved;
 *   // 사람이 토글하면
 *   if (window.DGL_AUDIO) window.DGL_AUDIO.setOverride(next);
 *
 * ★ 드롭인이 없을 때는 **종전대로 소리가 난다** — 배선이 빠졌다고 게임이 조용해지면
 *   그건 눈에 안 띄는 고장이다. 배선 여부는 게이트가 본다.
 */
(function () {
  if (window.DGL_AUDIO) return;

  /* 로컬로 볼 호스트 — 루프백 · `.local`(Bonjour) · 사설망(폰 실기 테스트) */
  var LOCAL_HOST =
    /^(localhost|0\.0\.0\.0|127(\.\d{1,3}){3}|\[?::1\]?|[^.]+\.local|[^.]+\.localhost|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/i;

  /** Capacitor 네이티브 웹뷰인가 — 여기서 true 면 **무조건 배포다** */
  function isNative() {
    try {
      var C = window.Capacitor;
      if (!C) return false;
      if (typeof C.isNativePlatform === 'function') return !!C.isNativePlatform();
      return !!C.platform && C.platform !== 'web';
    } catch (e) {
      return false;
    }
  }

  /**
   * 주소 하나가 «로컬 개발 서버» 인가 — **순수 함수**(테스트가 이걸 부른다).
   * 네이티브 판정은 여기 넣지 않는다: 주소만으로 답할 수 있어야 표로 검증된다.
   */
  function isLocalUrl(href) {
    var u;
    try {
      u = new URL(String(href));
    } catch (e) {
      return false;
    }
    /* ★ `file:` 은 **로컬이다** — 사장님이 dist 를 그냥 더블클릭해 여는 경우가 여기다.
       네이티브 웹뷰는 file: 이 아니다(iOS `capacitor://localhost` · Android `https://localhost`,
       실측: 게임 4종 capacitor.config 전부). 혹시 미래에 바뀌어도 `isNative()` 가 먼저 막는다.
       `capacitor:` · `ionic:` 은 배포 취급 — 그 스킴이 곧 네이티브다. */
    if (u.protocol === 'file:') return true;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!u.port) return false; // ★ 포트 없음 = 네이티브 웹뷰 가능성 → 로컬로 안 본다
    return LOCAL_HOST.test(u.hostname);
  }

  /** `?mute=` — 값이 없으면 null(판정 안 함), `0` 이면 켬, 나머지는 끔 */
  function urlForced(search) {
    try {
      var v = new URLSearchParams(search).get('mute');
      return v === null ? null : v !== '0';
    } catch (e) {
      return null;
    }
  }

  var forced = urlForced(location.search);
  var local = !isNative() && isLocalUrl(location.href);
  /* 이번 세션에 사람이 직접 정한 값. 저장소가 아니라 **메모리** 다 — 로컬에서 한 번 켰다고
     다음 부팅까지 시끄러우면 애초에 이 파일을 만든 이유가 사라진다. */
  var override = null;

  /**
   * ★★ 안전망 — 로컬이면 **스피커로 가는 선을 아예 끊는다.**
   *
   * 위의 판정(`muted()`)은 게임이 «물어봐 줘야» 듣는다. 그런데 소리를 내는 입구는 계속
   * 늘어나고(스플래시 · sound.js · 엔진 · 다음 게임), 한 곳이라도 안 물어보면 그 하나가
   * 로컬에서 울린다 — 그게 사장님이 두 번 말한 그 짜증이다
   * (*"스플래시도 끄고 걍 다 꺼, 소리 자체가 나면 안 돼"*).
   * 그래서 판정을 안 거친 코드까지 여기서 막는다. **로컬에서만** 돈다 — 배포에서는
   * 이 함수가 아예 안 불린다.
   *
   * ★ 게임을 깨뜨리지 않는 게 조건이다:
   *   · `play()` 는 **resolved Promise** 를 돌려준다. undefined 를 주면 흔한
   *     `play().catch(...)` 가 그 자리에서 터진다.
   *   · Web Audio 는 그래프를 그대로 둔 채 **destination 으로 가는 연결만** 끊고
   *     대상 노드를 반환한다(`connect` 의 원래 반환값). 게임 코드는 아무것도 모른다.
   *   · 무엇이 실패하든 통째로 삼킨다. 소리를 끄려다 게임이 안 뜨면 그게 더 큰 사고다.
   */
  function hardMute() {
    try {
      var M = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
      if (M && M.play && !M.play.__dgl) {
        var play = M.play;
        M.play = function () {
          try {
            this.muted = true;
            this.volume = 0;
          } catch (e) {}
          return Promise.resolve();
        };
        M.play.__dgl = play;
      }
      var N = window.AudioNode && window.AudioNode.prototype;
      if (N && N.connect && !N.connect.__dgl) {
        var connect = N.connect;
        N.connect = function (dest) {
          try {
            if (dest && dest.context && dest === dest.context.destination) return dest;
          } catch (e) {}
          return connect.apply(this, arguments);
        };
        N.connect.__dgl = connect;
      }
    } catch (e) {
      /* 안전망이 안 걸려도 판정(muted)은 그대로 돈다 */
    }
  }
  if (local) hardMute();

  /* 앱을 떠나면 모든 웹 게임의 소리를 멈춘다. Phaser/바닐라 게임이 각각 수명주기를
     배선하지 않아도 Web Audio 와 <audio> 양쪽에 적용된다. */
  (function installAppAudioLifecycle() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    var contexts = [];
    var suspended = [];
    var pausedMedia = [];
    var inactive = false;
    ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
      var NativeContext = window[name];
      if (!NativeContext) return;
      function TrackedContext(options) {
        var context = new NativeContext(options);
        contexts.push(context);
        if (inactive && context.suspend) context.suspend().catch(function () {});
        return context;
      }
      TrackedContext.prototype = NativeContext.prototype;
      window[name] = TrackedContext;
    });
    function stop() {
      if (inactive) return;
      inactive = true;
      contexts.forEach(function (context) {
        if (context.state === 'running') {
          suspended.push(context);
          context.suspend().catch(function () {});
        }
      });
      document.querySelectorAll('audio,video').forEach(function (media) {
        if (!media.paused) { pausedMedia.push(media); media.pause(); }
      });
    }
    function resume() {
      if (!inactive || document.hidden) return;
      inactive = false;
      suspended.splice(0).forEach(function (context) {
        if (context.state === 'suspended') context.resume().catch(function () {});
      });
      pausedMedia.splice(0).forEach(function (media) {
        if (media.isConnected) media.play().catch(function () {});
      });
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else resume(); });
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', resume);
    window.addEventListener('blur', stop);
    window.addEventListener('focus', resume);
    if (document.hidden) stop();
  })();

  window.DGL_AUDIO = {
    /** 지금 여기가 로컬 개발 서버인가 */
    local: local,
    /** `?mute=` 로 강제된 값 (없으면 null) */
    forced: forced,
    /** 최종 판정 — `saved` 는 게임이 저장해 둔 음소거 값 */
    muted: function (saved) {
      if (forced !== null) return forced;
      /* ★ 로컬이면 **무조건** 조용하다 — 게임 안 음소거 버튼으로도 못 켠다
         (2026-08-30 사장님: "걍 다 꺼, 소리 자체가 나면 안 돼").
         로컬에서 소리를 들을 유일한 길은 `?mute=0` 링크다. */
      if (local) return true;
      if (override !== null) return override;
      return !!saved;
    },
    /**
     * 사람이 게임 안에서 토글했다 — **배포에서만** 의미가 있다(로컬은 위에서 이미 잠긴다).
     * 저장소가 아니라 메모리에 둔다: 이 값이 남으면 다음 부팅이 또 시끄럽다.
     */
    setOverride: function (v) {
      override = !!v;
    },
    /** 테스트용 순수 함수 */
    isLocalUrl: isLocalUrl,
    /** 안전망이 실제로 걸렸나 — 진단·테스트용 */
    hardMuted: local && !!(window.HTMLMediaElement && window.HTMLMediaElement.prototype.play.__dgl),
  };
})();
