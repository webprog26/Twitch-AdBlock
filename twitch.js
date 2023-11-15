(function () {
  'use strict';
  let browser;
  try {
    
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    browser = {
      window: win,
      document: win.document,
      location: win.document.location,
      navigator: win.navigator,
      console: {},
      querySelector: win.document.querySelector.bind(win.document),
      querySelectorAll: win.document.querySelectorAll.bind(win.document),
      getAttribute: Function.prototype.call.bind(
        HTMLElement.prototype.getAttribute
      ),
      setAttribute: Function.prototype.call.bind(
        HTMLElement.prototype.setAttribute
      ),
      removeAttribute: Function.prototype.call.bind(
        HTMLElement.prototype.removeAttribute
      ),
      defineProperty: Object.defineProperty,
      MutationObserver: win.MutationObserver,
    };
    Object.keys(browser.window.console).forEach((name) => {
      browser.console[name] = browser.window.console[name];
    });
  } catch (_unused) {
    browser = {};
  }
  var browser$1 = browser;
  let TwitchAdblockSettings = {
    BannerVisible: null,
    ForcedQuality: null,
    ProxyType: null,
    ProxyQuality: null
  };
  let twitchMainWorker = null;
  function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }
  function gqlRequest(body) {
    if (!GQLDeviceID) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 32; i += 1) {
        GQLDeviceID += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    return fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Client-ID': ClientID,
        'Client-Integrity': ClientIntegrityHeader,
        'Device-ID': GQLDeviceID,
        'X-Device-Id': GQLDeviceID,
        'Client-Version': ClientVersion,
        'Client-Session-Id': ClientSession,
        Authorization: AuthorizationHeader
      }
    });
  }
  function parseAttributes(str) {
    return Object.fromEntries(str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/).filter(x => !!x).map(x => {
      const idx = x.indexOf('=');
      const key = x.substring(0, idx);
      const value = x.substring(idx + 1);
      if (value.startsWith('"')) {
        return [key, JSON.parse(value)];
      }
      const num = parseInt(value, 10);
      if (!Number.isNaN(num)) {
        return [key, num];
      }
      return [key, value];
    }));
  }
  function getAccessToken(channelName, playerType) {
    const query = 'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "ios", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature    __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: "ios", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature    __typename  }}';
    const body = {
      operationName: 'PlaybackAccessToken_Template',
      query,
      variables: {
        isLive: true,
        login: channelName,
        isVod: false,
        vodID: '',
        playerType
      }
    };
    return gqlRequest(body);
  }
  function getStreamUrlForResolution(encodingsM3u8, resolutionInfo, qualityOverrideStr) {
    let qualityOverride = 0;
    if (qualityOverrideStr && qualityOverrideStr.endsWith('p')) {
      const numericPart = qualityOverrideStr.slice(0, -1);
      const numericValue = parseInt(numericPart, 10);
      if (!Number.isNaN(numericValue)) {
        qualityOverride = numericValue;
      }
    }
    const encodingsLines = encodingsM3u8.replace('\r', '').split('\n');
    let firstUrl = null;
    let lastUrl = null;
    let matchedResolutionUrl = null;
    let matchedFrameRate = false;
    for (let i = 0; i < encodingsLines.length; i += 1) {
      const line = encodingsLines[i];
      const previousLine = encodingsLines[i - 1];
      if (line.startsWith('#') || !line.includes('.m3u8')) {
        continue;
      }
      if (i === 0 || !previousLine.startsWith('#EXT-X-STREAM-INF')) {
        continue;
      }
      const attributes = parseAttributes(previousLine);
      const resolution = attributes.RESOLUTION;
      if (!resolution) {
        continue;
      }
      const frameRate = attributes['FRAME-RATE'];
      if (qualityOverride) {
        const quality = resolution.toLowerCase().split('x')[1];
        if (parseInt(quality, 10) === qualityOverride) {
          qualityOverrideFoundQuality = quality;
          qualityOverrideFoundFrameRate = frameRate;
          matchedResolutionUrl = line;
          if (frameRate < 40) {
            return matchedResolutionUrl;
          }
        } else if (quality < qualityOverride) {
          return matchedResolutionUrl || line;
        }
      } else if ((!resolutionInfo || resolution === resolutionInfo.Resolution) && (!matchedResolutionUrl || !matchedFrameRate && frameRate === resolutionInfo.FrameRate)) {
        matchedResolutionUrl = line;
        matchedFrameRate = frameRate === resolutionInfo.FrameRate;
        if (matchedFrameRate) {
          return matchedResolutionUrl;
        }
      }
      if (!firstUrl) {
        firstUrl = line;
      }
      lastUrl = line;
    }
    if (qualityOverride) {
      return lastUrl;
    }
    return matchedResolutionUrl || firstUrl;
  }
  async function getStreamForResolution(streamInfo, resolutionInfo, encodingsM3u8, fallbackStreamStr, playerType, realFetch) {
    const qualityOverride = null;
    if (streamInfo.EncodingsM3U8Cache[playerType].Resolution !== resolutionInfo.Resolution || streamInfo.EncodingsM3U8Cache[playerType].RequestTime < Date.now() - EncodingCacheTimeout) {
      /*console.log(`Blocking ads (
    type:${playerType},
    resolution:${resolutionInfo.Resolution},
    frameRate:${resolutionInfo.FrameRate},
    qualityOverride:${qualityOverride}
)`);*/
    }
    streamInfo.EncodingsM3U8Cache[playerType].RequestTime = Date.now();
    streamInfo.EncodingsM3U8Cache[playerType].Value = encodingsM3u8;
    streamInfo.EncodingsM3U8Cache[playerType].Resolution = resolutionInfo.Resolution;
    const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, resolutionInfo, qualityOverride);
    const streamM3u8Response = await realFetch(streamM3u8Url);
    if (streamM3u8Response.status === 200) {
      const m3u8Text = await streamM3u8Response.text();
      WasShowingAd = true;
      postMessage({
        key: 'ShowAdBlockBanner'
      });
      postMessage({
        key: 'ForceChangeQuality'
      });
      if (!m3u8Text || m3u8Text.includes(AdSignifier)) {
        streamInfo.EncodingsM3U8Cache[playerType].Value = null;
      }
      return m3u8Text;
    }
    streamInfo.EncodingsM3U8Cache[playerType].Value = null;
    return fallbackStreamStr;
  }
  async function processM3U8(url, textStr, realFetch, playerType) {
    const streamInfo = StreamInfosByUrl[url];
    if (IsSquadStream || !textStr || !textStr.includes('.ts') && !textStr.includes('.mp4')) {
      return textStr;
    }
    if (!textStr.includes(AdSignifier)) {
      if (WasShowingAd) {
        // console.log('Finished blocking ads');
        WasShowingAd = false;
        postMessage({
          key: 'ForceChangeQuality',
          value: 'original'
        });
        postMessage({
          key: 'PauseResumePlayer'
        });
        postMessage({
          key: 'HideAdBlockBanner'
        });
      }
      return textStr;
    }
    let currentResolution = null;
    if (streamInfo && streamInfo.Urls) {
      for (const [resUrl, resInfo] of Object.entries(streamInfo.Urls)) {
        if (resUrl === url) {
          currentResolution = resInfo;
          break;
        }
      }
    }
    const encodingsM3U8Cache = streamInfo.EncodingsM3U8Cache[playerType];
    if (encodingsM3U8Cache) {
      const {
        Value,
        RequestTime
      } = encodingsM3U8Cache;
      if (Value && RequestTime >= Date.now() - EncodingCacheTimeout) {
        try {
          const result = getStreamForResolution(streamInfo, currentResolution, Value, null, playerType, realFetch);
          if (result) {
            return result;
          }
        } catch (err) {
          encodingsM3U8Cache.Value = null;
        }
      }
    } else {
      streamInfo.EncodingsM3U8Cache[playerType] = {
        RequestTime: Date.now(),
        Value: null,
        Resolution: null
      };
    }
    const accessTokenResponse = await getAccessToken(CurrentChannelName, playerType);
    if (accessTokenResponse.status !== 200) {
      return textStr;
    }
    const accessToken = await accessTokenResponse.json();
    const {
      signature,
      value
    } = accessToken.data.streamPlaybackAccessToken;
    let encodingsM3u8Response;
    try {
      const urlInfo = new URL(`https://usher.ttvnw.net/api/channel/hls/${CurrentChannelName}.m3u8${UsherParams}`);
      urlInfo.searchParams.set('sig', signature);
      urlInfo.searchParams.set('token', value);
      encodingsM3u8Response = await realFetch(urlInfo.href);
    } catch (e) {
    }
    return encodingsM3u8Response && encodingsM3u8Response.status === 200 ? getStreamForResolution(streamInfo, currentResolution, await encodingsM3u8Response.text(), textStr, playerType, realFetch) : textStr;
  }
  function getWasmWorkerUrl(twitchBlobUrl) {
    const req = new XMLHttpRequest();
    req.open('GET', twitchBlobUrl, false);
    req.send();
    return req.responseText.split("'")[1];
  }
  function hookWorkerFetch() {
    // console.log('Twitch adblocker is enabled');
    const realFetch = fetch;
    fetch = async function fetch(url, options) {
      if (typeof url !== 'string') {
        return realFetch.apply(this, arguments);
      }
      if (url.includes('video-weaver')) {
        return new Promise((resolve, reject) => {
          async function processAfter(response) {
            const responseText = await response.text();
            let weaverText = null;
            weaverText = await processM3U8(url, responseText, realFetch, PlayerType2);
            if (weaverText.includes(AdSignifier)) {
              weaverText = await processM3U8(url, responseText, realFetch, PlayerType3);
            }
            resolve(new Response(weaverText));
          }
          realFetch(url, options).then(processAfter).catch(reject);
        });
      }
      if (url.includes('/api/channel/hls/')) {
        const channelName = new URL(url).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
        UsherParams = new URL(url).search;
        CurrentChannelName = channelName;
        const isPBYPRequest = url.includes('picture-by-picture');
        if (isPBYPRequest) {
          url = '';
        }
        return new Promise((resolve, reject) => {
          async function processAfter(response) {
            if (response.status !== 200) {
              resolve(response);
            }
            encodingsM3u8 = await response.text();
            let streamInfo = StreamInfos[channelName];
            if (streamInfo == null) {
              StreamInfos[channelName] = {};
              streamInfo = {};
            }
            streamInfo.ChannelName = channelName;
            streamInfo.Urls = [];
            streamInfo.EncodingsM3U8Cache = [];
            streamInfo.EncodingsM3U8 = encodingsM3u8;
            const lines = encodingsM3u8.replace('\r', '').split('\n');
            for (let i = 0; i < lines.length; i += 1) {
              const line = lines[i];
              const previousLine = lines[i - 1];
              if (!line.startsWith('#') && line.includes('.m3u8')) {
                streamInfo.Urls[line] = -1;
                StreamInfosByUrl[line] = streamInfo;
                MainUrlByUrl[line] = url;
                if (i === 0 || !previousLine.startsWith('#EXT-X-STREAM-INF')) {
                  continue;
                }
                const attributes = parseAttributes(previousLine);
                const resolution = attributes.RESOLUTION;
                const frameRate = attributes['FRAME-RATE'];
                if (resolution) {
                  streamInfo.Urls[line] = {
                    Resolution: resolution,
                    FrameRate: frameRate
                  };
                }
              }
            }
            resolve(new Response(encodingsM3u8));
          }
          realFetch(url, options).then(processAfter).catch(reject);
        });
      }
      return realFetch.apply(this, arguments);
    };
  }
  function stripUnusedParams(str) {
    let params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : ['token', 'sig'];
    const tempUrl = new URL(`https://localhost/${str}`);
    for (let i = 0; i < params.length; i += 1) {
      tempUrl.searchParams.delete(params[i]);
    }
    return tempUrl.pathname.substring(1) + tempUrl.search;
  }
  function adRecordgqlPacket(event, radToken, payload) {
    const gqlRequestBody = {
      operationName: 'ClientSideAdEventHandling_RecordAdEvent',
      variables: {
        input: {
          eventName: event,
          eventPayload: JSON.stringify(payload),
          radToken
        }
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: '7e6c69e6eb59f8ccb97ab73686f3d8b7d85a72a0298745ccd8bfc68e4054ca5b'
        }
      }
    };
    return [gqlRequestBody];
  }
  async function tryNotifyTwitch(streamM3u8) {
    const matches = streamM3u8.match(/#EXT-X-DATERANGE:(ID="stitched-ad-[^\n]+)\n/);
    if (!matches || matches.length <= 1) {
      return;
    }
    const attrString = matches[1];
    const attr = parseAttributes(attrString);
    const adId = attr['X-TV-TWITCH-AD-ADVERTISER-ID'];
    const rollType = attr['X-TV-TWITCH-AD-ROLL-TYPE'].toLowerCase();
    const creativeId = attr['X-TV-TWITCH-AD-CREATIVE-ID'];
    const orderId = attr['X-TV-TWITCH-AD-ORDER-ID'];
    const lineItemId = attr['X-TV-TWITCH-AD-LINE-ITEM-ID'];
    const baseData = {
      stitched: true,
      ad_id: adId,
      roll_type: rollType,
      creative_id: creativeId,
      order_id: orderId,
      line_item_id: lineItemId,
      player_mute: true,
      player_volume: 0.0,
      visible: false,
      duration: 0
    };
    const podLength = parseInt(attr['X-TV-TWITCH-AD-POD-LENGTH'] || '1', 10);
    const radToken = attr['X-TV-TWITCH-AD-RADS-TOKEN'];
    for (let podPosition = 0; podPosition < podLength; podPosition += 1) {
      const extendedData = _objectSpread(_objectSpread({}, baseData), {}, {
        ad_position: podPosition,
        total_ads: podLength
      });
      const adRecord = adRecordgqlPacket('video_ad_impression', radToken, extendedData);
      await gqlRequest(adRecord);
      for (let quartile = 0; quartile < 4; quartile += 1) {
        const adQuartileRecord = adRecordgqlPacket('video_ad_quartile_complete', radToken, _objectSpread(_objectSpread({}, extendedData), {}, {
          quartile: quartile + 1
        }));
        await gqlRequest(adQuartileRecord);
      }
      const adCompleteRecord = adRecordgqlPacket('video_ad_pod_complete', radToken, baseData);
      await gqlRequest(adCompleteRecord);
    }
  }
  function pauseResumeTwitchPlayer() {
    var _rootNode$_reactRootC, _rootNode$_reactRootC2, _videoPlayer, _videoPlayer$props;
    function findReactNode(root, constraint) {
      if (root.stateNode && constraint(root.stateNode)) {
        return root.stateNode;
      }
      let node = root.child;
      while (node) {
        const targetNode = findReactNode(node, constraint);
        if (targetNode) {
          return targetNode;
        }
        node = node.sibling;
      }
      return null;
    }
    const rootNode = browser$1.querySelector('#root');
    const reactRootNode = rootNode === null || rootNode === void 0 ? void 0 : (_rootNode$_reactRootC = rootNode._reactRootContainer) === null || _rootNode$_reactRootC === void 0 ? void 0 : (_rootNode$_reactRootC2 = _rootNode$_reactRootC._internalRoot) === null || _rootNode$_reactRootC2 === void 0 ? void 0 : _rootNode$_reactRootC2.current;
    if (!reactRootNode) {
      return;
    }
    let videoPlayer = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
    videoPlayer = ((_videoPlayer = videoPlayer) === null || _videoPlayer === void 0 ? void 0 : (_videoPlayer$props = _videoPlayer.props) === null || _videoPlayer$props === void 0 ? void 0 : _videoPlayer$props.mediaPlayerInstance) || null;
    videoPlayer.pause();
    videoPlayer.play();
  }
  function hookFetch() {
    const localDeviceID = browser$1.window.localStorage.getItem('local_copy_unique_id');
    const realFetch = browser$1.window.fetch;
    function newFetch() {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      let url = args[0];
      const options = args[1];
      if (typeof url !== 'string') {
        return realFetch.apply(this, args);
      }
      if (twitchMainWorker) {
        twitchMainWorker.postMessage({
          key: 'UpdateIsSquadStream',
          value: browser$1.location.pathname.includes('/squad')
        });
      }
      if (!url.includes('/access_token') && !url.includes('gql')) {
        return realFetch.apply(this, args);
      }
      const deviceId = options.headers['X-Device-Id'] || options.headers['Device-ID'];
      if (typeof deviceId === 'string' && !deviceId.includes('twitch-web-wall-mason')) {
        GQLDeviceID = deviceId;
      } else if (localDeviceID) {
        GQLDeviceID = localDeviceID.replace('"', '').replace('"', '');
      }
      if (GQLDeviceID && twitchMainWorker) {
        if (typeof options.headers['X-Device-Id'] === 'string') {
          options.headers['X-Device-Id'] = GQLDeviceID;
        }
        if (typeof options.headers['Device-ID'] === 'string') {
          options.headers['Device-ID'] = GQLDeviceID;
        }
        twitchMainWorker.postMessage({
          key: 'UpdateDeviceId',
          value: GQLDeviceID
        });
      }
      const clientVersion = options.headers['Client-Version'];
      if (clientVersion && typeof clientVersion === 'string') {
        ClientVersion = clientVersion;
      }
      if (ClientVersion && twitchMainWorker) {
        twitchMainWorker.postMessage({
          key: 'UpdateClientVersion',
          value: ClientVersion
        });
      }
      const clientSession = options.headers['Client-Session-Id'];
      if (clientSession && typeof clientSession === 'string') {
        ClientSession = clientSession;
      }
      if (ClientSession && twitchMainWorker) {
        twitchMainWorker.postMessage({
          key: 'UpdateClientSession',
          value: ClientSession
        });
      }
      if (url.includes('gql') && options && typeof options.body === 'string' && options.body.includes('PlaybackAccessToken')) {
        const clientId = options.headers['Client-ID'];
        if (clientId && typeof clientId === 'string') {
          ClientID = clientId;
        }
        if (ClientID && twitchMainWorker) {
          twitchMainWorker.postMessage({
            key: 'UpdateClientId',
            value: ClientID
          });
        }
        ClientIntegrityHeader = options.headers['Client-Integrity'];
        twitchMainWorker.postMessage({
          key: 'UpdateClientIntegrityHeader',
          value: options.headers['Client-Integrity']
        });
        AuthorizationHeader = options.headers.Authorization;
        twitchMainWorker.postMessage({
          key: 'UpdateAuthorizationHeader',
          value: options.headers.Authorization
        });
        if (options.body.includes('PlaybackAccessToken') && options.body.includes('picture-by-picture')) {
          options.body = '';
        }
      }
      if (url.includes('picture-by-picture')) {
        url = '';
      }
      return realFetch.apply(this, args);
    }
    browser$1.window.fetch = newFetch;
  }
  function declareOptions(scope) {
    scope.AdSignifier = 'stitched';
    scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
    scope.ClientVersion = 'null';
    scope.ClientSession = 'null';
    scope.PlayerType2 = 'embed';
    scope.PlayerType3 = 'autoplay';
    scope.CurrentChannelName = null;
    scope.UsherParams = null;
    scope.WasShowingAd = false;
    scope.GQLDeviceID = null;
    scope.IsSquadStream = false;
    scope.StreamInfos = [];
    scope.StreamInfosByUrl = [];
    scope.MainUrlByUrl = [];
    scope.EncodingCacheTimeout = 60000;
    scope.DefaultProxyType = null;
    scope.DefaultForcedQuality = null;
    scope.DefaultProxyQuality = null;
    scope.ClientIntegrityHeader = null;
    scope.AuthorizationHeader = null;
  }
  const isWorkerIntact = () => {
    const iframe = browser$1.window.document.createElement('iframe');
    browser$1.window.document.body.append(iframe);
    const cleanWindow = iframe.contentWindow;
    if (cleanWindow.Worker.toString() === browser$1.window.Worker.toString()) {
      iframe.remove();
      return true;
    }
    iframe.remove();
    return false;
  };
  function init() {
    try {
      browser$1.defineProperty(browser$1.document, 'visibilityState', {
        get() {
          return 'visible';
        }
      });
      browser$1.defineProperty(browser$1.document, 'hidden', {
        get() {
          return false;
        }
      });
      const vendorProp = /Firefox/.test(browser$1.navigator.userAgent) ? 'mozHidden' : 'webkitHidden';
      browser$1.defineProperty(browser$1.document, vendorProp, {
        get() {
          return false;
        }
      });
      const documentEventsToBlock = ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'hasFocus'];
      const block = e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      documentEventsToBlock.forEach(event => {
        browser$1.document.addEventListener(event, block, true);
      });
    } catch (e) {
    }
    browser$1.window.addEventListener('message', event => {
      const {
        data: {
          type,
          settings
        },
        source
      } = event;
      if (source !== browser$1.window) {
        return;
      }
      if (type === 'SetTwitchAdblockSettings' && settings) {
        TwitchAdblockSettings = settings;
      }
    });
    declareOptions(browser$1.window);
    const oldWorker = browser$1.window.Worker;
    browser$1.window.Worker = class Worker extends oldWorker {
      constructor(twitchBlobUrl) {
        if (twitchMainWorker) {
          super(twitchBlobUrl);
          return;
        }
        const jsURL = getWasmWorkerUrl(twitchBlobUrl);
        if (typeof jsURL !== 'string') {
          super(twitchBlobUrl);
          return;
        }
        const newBlobStr = `
                    ${getStreamUrlForResolution.toString()}
                    ${getStreamForResolution.toString()}
                    ${stripUnusedParams.toString()}
                    ${processM3U8.toString()}
                    ${hookWorkerFetch.toString()}
                    ${declareOptions.toString()}
                    ${getAccessToken.toString()}
                    ${gqlRequest.toString()}
                    ${adRecordgqlPacket.toString()}
                    ${tryNotifyTwitch.toString()}
                    ${parseAttributes.toString()}
                    declareOptions(self);
                    self.TwitchAdblockSettings = ${JSON.stringify(TwitchAdblockSettings)};
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UpdateIsSquadStream') {
                            IsSquadStream = e.data.value;
                        } else if (e.data.key == 'UpdateClientVersion') {
                            ClientVersion = e.data.value;
                        } else if (e.data.key == 'UpdateClientSession') {
                            ClientSession = e.data.value;
                        } else if (e.data.key == 'UpdateClientId') {
                            ClientID = e.data.value;
                        } else if (e.data.key == 'UpdateDeviceId') {
                            GQLDeviceID = e.data.value;
                        } else if (e.data.key == 'UpdateClientIntegrityHeader') {
                            ClientIntegrityHeader = e.data.value;
                        } else if (e.data.key == 'UpdateAuthorizationHeader') {
                            AuthorizationHeader = e.data.value;
                        }
                    });
                    hookWorkerFetch();
                    importScripts('${jsURL}');
                `;
        super(URL.createObjectURL(new Blob([newBlobStr])));
        twitchMainWorker = this;
        const adblockNoticeManager = (() => {
          let adblockNotice = null;
          return {
            getNotice() {
              if (adblockNotice instanceof HTMLElement) {
                return adblockNotice;
              }
              const playerRootDiv = browser$1.querySelector('.video-player');
              if (!playerRootDiv) {
                return null;
              }
              const overlayElement = playerRootDiv === null || playerRootDiv === void 0 ? void 0 : playerRootDiv.querySelector('.adblock-overlay');
              if (overlayElement) {
                adblockNotice = overlayElement;
                return adblockNotice;
              }
              const overlayStub = browser$1.document.createElement('div');
              overlayStub.className = 'adblock-overlay';
              overlayStub.innerHTML = '<div class="player-adblock-notice" style="color: white; background-color: rgba(0, 0, 0, 0.8); position: absolute; top: 0px; left: 0px; padding: 5px;"><p></p></div>';
              overlayStub.style.display = 'none';
              overlayStub.P = overlayStub.querySelector('p');
              playerRootDiv.appendChild(overlayStub);
              adblockNotice = overlayStub;
              return adblockNotice;
            },
            showNotice() {
              const notice = this.getNotice();
              if (notice) {
                notice.P.textContent = 'Blocking ads';
                notice.style.display = 'block';
              }
            },
            hideNotice() {
              const notice = this.getNotice();
              if (notice) {
                notice.style.display = 'none';
              }
            }
          };
        })();
        this.onmessage = e => {
          const {
            data: {
              key
            }
          } = e;
          switch (key) {
            case 'ShowAdBlockBanner':
              if (!TwitchAdblockSettings.BannerVisible) {
                return;
              }
              adblockNoticeManager.showNotice();
              break;
            case 'HideAdBlockBanner':
              adblockNoticeManager.hideNotice();
              break;
            case 'PauseResumePlayer':
              pauseResumeTwitchPlayer();
              break;
          }
        };
      }
    };
    hookFetch();
  }
  browser$1.window.addEventListener('DOMContentLoaded', () => {
    if (!isWorkerIntact()) {
      return;
    }
    init();
  });
})();
