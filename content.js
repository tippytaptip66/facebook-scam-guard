(() = {
  const STATE = {
    settings { enabled true, blockHighRisk true, sensitivity medium },
    blacklist new Set(),
    official [],
    phrases [],
    scannedLinks new WeakSet(),
    profileBannerShown false
  };

  const SCORE_THRESHOLDS = {
    low { suspicious 45, high 75 },
    medium { suspicious 35, high 65 },
    high { suspicious 25, high 55 }
  };

  const SHORTENERS = new Set([
    bit.ly, tinyurl.com, t.co, goo.gl, is.gd, cutt.ly, rb.gy
  ]);

  const SUSPICIOUS_TLDS = new Set([
    zip, mov, click, country, stream, gq, tk, ml, ga, cf
  ]);

  const CSS = `
  .sg-badge { 
    display inline-flex; align-items center; gap 6px;
    font-size 12px; font-weight 600; padding 2px 8px;
    border-radius 999px; margin-left 6px; line-height 1.4;
    border 1px solid transparent; 
  }
  .sg-badge-high { background #ffe5e5; color #8a1f1f; border-color #f5b5b5; }
  .sg-badge-mid { background #fff4e5; color #8a5a1f; border-color #f5d0a5; }
  .sg-badge-low { background #e9f7ec; color #1f6b2a; border-color #bfe5c6; }
  .sg-banner {
    position relative; z-index 9999;
    margin 8px 0; padding 10px 12px; border-radius 8px;
    border 1px solid #ddd; font-size 14px; font-weight 600;
  }
  .sg-banner-high { background #ffe5e5; color #8a1f1f; border-color #f5b5b5; }
  .sg-banner-mid { background #fff4e5; color #8a5a1f; border-color #f5d0a5; }
  .sg-banner-low { background #e9f7ec; color #1f6b2a; border-color #bfe5c6; }
  .sg-tooltip {
    position absolute; z-index 9999; max-width 260px;
    background #111; color #fff; padding 8px 10px; border-radius 6px;
    font-size 12px; box-shadow 0 4px 12px rgba(0,0,0,0.2);
    pointer-events none; opacity 0; transition opacity 0.12s ease;
  }
  .sg-modal-backdrop {
    position fixed; inset 0; background rgba(0,0,0,0.45);
    z-index 999999;
  }
  .sg-modal {
    position fixed; top 50%; left 50%; transform translate(-50%, -50%);
    background #fff; color #111; border-radius 10px; padding 16px;
    width 90%; max-width 420px; z-index 1000000;
    box-shadow 0 10px 30px rgba(0,0,0,0.25);
    font-family system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  }
  .sg-modal h3 { margin 0 0 8px 0; font-size 16px; }
  .sg-modal p { margin 0 0 12px 0; font-size 13px; color #333; }
  .sg-btn {
    border none; padding 8px 12px; border-radius 6px;
    font-weight 600; cursor pointer; margin-right 8px;
  }
  .sg-btn-danger { background #e53935; color #fff; }
  .sg-btn-ghost { background #eee; color #111; }
  `;

  injectStyles();

  init();

  async function init() {
    await loadSettings();
    await loadData();
    if (!STATE.settings.enabled) return;

    scanAll();
    observeDom();
    setInterval(scanAll, 6000);
    setInterval(scanProfile, 4000);
  }

  function injectStyles() {
    if (document.getElementById(sg-styles)) return;
    const style = document.createElement(style);
    style.id = sg-styles;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function loadSettings() {
    return new Promise((resolve) = {
      chrome.storage.sync.get([enabled, blockHighRisk, sensitivity], (res) = {
        STATE.settings = {
          enabled res.enabled !== undefined  res.enabled  true,
          blockHighRisk res.blockHighRisk !== undefined  res.blockHighRisk  true,
          sensitivity res.sensitivity  medium
        };
        resolve();
      });
    });
  }

  async function loadData() {
    const [blacklist, official, phrases] = await Promise.all([
      fetch(chrome.runtime.getURL(datablacklist.json)).then(r = r.json()).catch(() = []),
      fetch(chrome.runtime.getURL(dataofficial_accounts.json)).then(r = r.json()).catch(() = []),
      fetch(chrome.runtime.getURL(datascam_phrases.json)).then(r = r.json()).catch(() = [])
    ]);

    STATE.blacklist = new Set(blacklist.map(d = d.toLowerCase()));
    STATE.official = official;
    STATE.phrases = phrases;
  }

  function observeDom() {
    const observer = new MutationObserver((mutations) = {
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length  0) {
          scanAll();
        }
      }
    });
    observer.observe(document.body, { childList true, subtree true });
  }

  function scanAll() {
    scanLinks();
    scanPosts();
  }

  function scanLinks() {
    const links = Array.from(document.querySelectorAll('a[href^=http]'));
    for (const link of links) {
      if (STATE.scannedLinks.has(link)) continue;
      STATE.scannedLinks.add(link);

      const href = link.getAttribute(href);
      const contextText = getContextText(link);
      const result = assessLink(href, contextText);

      if (result.level !== safe) {
        addBadge(link, result);
        addHoverTooltip(link, result);
        if (STATE.settings.blockHighRisk && result.level === high) {
          link.addEventListener(click, (e) = {
            e.preventDefault();
            e.stopPropagation();
            showBlockModal(href, result);
          }, { capture true });
        }
      }
    }
  }

  function scanPosts() {
    const posts = Array.from(document.querySelectorAll('div[role=article]'));
    for (const post of posts) {
      if (post.dataset.sgScanned === 1) continue;
      post.dataset.sgScanned = 1;

      const text = (post.innerText  ).toLowerCase();
      const textScore = assessText(text);

      if (textScore.level !== safe) {
        const banner = document.createElement(div);
        banner.className = `sg-banner sg-banner-${levelToClass(textScore.level)}`;
        banner.textContent = textScore.message;
        post.prepend(banner);
      }
    }
  }

  function scanProfile() {
    if (STATE.profileBannerShown) return;

    const h1 = document.querySelector('h1');
    if (!h1) return;

    const name = normalize(h1.textContent  );
    if (!name) return;

    const verified = isVerifiedBadgePresent();
    const identityResult = assessIdentity(name, verified);

    if (identityResult.level !== safe) {
      const container = h1.parentElement;
      if (container) {
        const banner = document.createElement(div);
        banner.className = `sg-banner sg-banner-${levelToClass(identityResult.level)}`;
        banner.textContent = identityResult.message;
        container.prepend(banner);
        STATE.profileBannerShown = true;
      }
    } else if (identityResult.level === safe && identityResult.message) {
      const container = h1.parentElement;
      if (container) {
        const banner = document.createElement(div);
        banner.className = `sg-banner sg-banner-low`;
        banner.textContent = identityResult.message;
        container.prepend(banner);
        STATE.profileBannerShown = true;
      }
    }
  }

  function addBadge(link, result) {
    const badge = document.createElement(span);
    badge.className = `sg-badge sg-badge-${levelToClass(result.level)}`;
    badge.textContent = result.badge;
    link.appendChild(badge);
  }

  function addHoverTooltip(link, result) {
    let tooltip;
    link.addEventListener(mouseenter, (e) = {
      tooltip = document.createElement(div);
      tooltip.className = sg-tooltip;
      tooltip.textContent = result.message;
      document.body.appendChild(tooltip);
      positionTooltip(tooltip, e.clientX, e.clientY);
      requestAnimationFrame(() = tooltip.style.opacity = 1);
    });
    link.addEventListener(mousemove, (e) = {
      if (tooltip) positionTooltip(tooltip, e.clientX, e.clientY);
    });
    link.addEventListener(mouseleave, () = {
      if (tooltip) {
        tooltip.style.opacity = 0;
        setTimeout(() = tooltip && tooltip.remove(), 120);
      }
    });
  }

  function positionTooltip(el, x, y) {
    const padding = 12;
    el.style.left = `${x + padding}px`;
    el.style.top = `${y + padding}px`;
  }

  function showBlockModal(url, result) {
    const backdrop = document.createElement(div);
    backdrop.className = sg-modal-backdrop;

    const modal = document.createElement(div);
    modal.className = sg-modal;
    modal.innerHTML = `
      h3🔴 HIGH RISK — Scam Detectedh3
      p${result.message}p
      pstrongURLstrong ${escapeHtml(url)}p
      div
        button class=sg-btn sg-btn-dangerBlock Linkbutton
        button class=sg-btn sg-btn-ghostProceed Anywaybutton
      div
    `;

    const [blockBtn, proceedBtn] = modal.querySelectorAll(button);

    blockBtn.addEventListener(click, () = {
      backdrop.remove();
      modal.remove();
    });

    proceedBtn.addEventListener(click, () = {
      backdrop.remove();
      modal.remove();
      window.open(url, _blank, noopener);
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
  }

  function assessLink(url, contextText) {
    let score = 0;
    const reasons = [];

    let parsed;
    try { parsed = new URL(url); } catch { parsed = null; }

    if (!parsed) {
      score += 50;
      reasons.push(Malformed URL);
    } else {
      const domain = parsed.hostname.toLowerCase();

      if (STATE.blacklist.has(domain)) {
        score += 80;
        reasons.push(Domain is in local blacklist);
      }

      if (SHORTENERS.has(domain)) {
        score += 25;
        reasons.push(Shortened link);
      }

      const tld = domain.split(.).pop();
      if (SUSPICIOUS_TLDS.has(tld)) {
        score += 20;
        reasons.push(Suspicious TLD);
      }

      if (domain.includes(@)) {
        score += 20;
        reasons.push(URL contains @ (obfuscation));
      }

      if (domain.startsWith(xn--)) {
        score += 20;
        reasons.push(Punycode domain);
      }

      if (isIpAddress(domain)) {
        score += 30;
        reasons.push(Raw IP address);
      }

      const subdomains = domain.split(.).length - 2;
      if (subdomains = 3) {
        score += 15;
        reasons.push(Excessive subdomains);
      }
    }

    const textScore = assessText(contextText);
    if (textScore.level !== safe) {
      score += textScore.score;
      reasons.push(Scam language in nearby text);
    }

    const level = scoreToLevel(score);
    const badge = level === high  🔴 High Risk  level === suspicious  🟡 Suspicious  🟢 Safe;
    const message = level === high
       `Scam likely ${reasons.join(; )}`
       level === suspicious
       `Be careful ${reasons.join(; )}`
       No threats detected;

    return { score, level, badge, message };
  }

  function assessText(text) {
    if (!text) return { score 0, level safe, message , badge  };

    const hits = [];
    for (const phrase of STATE.phrases) {
      if (text.includes(phrase.toLowerCase())) {
        hits.push(phrase);
      }
    }

    let score = 0;
    if (hits.length  0) score += Math.min(40, hits.length  10);

     Money + urgency pattern
    if ((winprizegiveawaydonatecashgcashpaypal₱$)i.test(text) &&
        (urgentnowlimitedfirstclickclaimfree)i.test(text)) {
      score += 25;
      hits.push(money+urgency pattern);
    }

    const level = scoreToLevel(score);
    const message = level === high
       ⚠️ Scam language detected (high risk).
       level === suspicious
       ⚠️ Scam language detected (suspicious).
       ;

    return { score, level, message, hits };
  }

  function assessIdentity(name, verified) {
    const normalized = normalize(name);

     Check against official list
    let officialMatch = null;
    for (const entry of STATE.official) {
      const names = [entry.name].concat(entry.aliases  []);
      for (const n of names) {
        if (normalize(n) === normalized) {
          officialMatch = entry;
          break;
        }
      }
      if (officialMatch) break;
    }

    if (officialMatch && !verified) {
      return {
        level high,
        message 🚫 Possible impersonation name matches a known public figure but no verification badge.
      };
    }

    if (officialMatch && verified) {
      return {
        level safe,
        message 🟢 Verified Authentic Account (matches official list).
      };
    }

     Similarity heuristic
    const closeMatch = closestOfficialName(normalized);
    if (closeMatch && !verified) {
      return {
        level suspicious,
        message `⚠️ Name is similar to a public figure (“${closeMatch}”). Verify before interacting.`
      };
    }

    if (!verified && (officialrealverified)i.test(name)) {
      return {
        level suspicious,
        message ⚠️ Account claims to be official but is not verified.
      };
    }

    if (verified) {
      return {
        level safe,
        message 🟢 Verified Authentic Account.
      };
    }

    return { level safe, message  };
  }

  function closestOfficialName(name) {
    let best = null;
    let bestScore = 999;
    for (const entry of STATE.official) {
      const d = editDistance(name, normalize(entry.name));
      if (d  bestScore) {
        bestScore = d;
        best = entry.name;
      }
    }
    return bestScore = 3  best  null;
  }

  function scoreToLevel(score) {
    const t = SCORE_THRESHOLDS[STATE.settings.sensitivity]  SCORE_THRESHOLDS.medium;
    if (score = t.high) return high;
    if (score = t.suspicious) return suspicious;
    return safe;
  }

  function levelToClass(level) {
    return level === high  high  level === suspicious  mid  low;
  }

  function getContextText(el) {
    const parent = el.closest('div[role=article]')  el.parentElement;
    return (parent && parent.innerText  parent.innerText  ).toLowerCase();
  }

  function isIpAddress(host) {
    return ^d{1,3}(.d{1,3}){3}$.test(host);
  }

  function isVerifiedBadgePresent() {
    const badge1 = document.querySelector('svg[aria-label=Verified]');
    const badge2 = document.querySelector('span[aria-label=Verified]');
    return Boolean(badge1  badge2);
  }

  function normalize(s) {
    return (s  )
      .toLowerCase()
      .replace([^a-z0-9]g, )
      .trim();
  }

  function editDistance(a, b) {
    const dp = Array.from({ length a.length + 1 }, () = Array(b.length + 1).fill(0));
    for (let i = 0; i = a.length; i++) dp[i][0] = i;
    for (let j = 0; j = b.length; j++) dp[0][j] = j;
    for (let i = 1; i = a.length; i++) {
      for (let j = 1; j = b.length; j++) {
        const cost = a[i - 1] === b[j - 1]  0  1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[a.length][b.length];
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll(&, &amp;)
      .replaceAll(, &lt;)
      .replaceAll(, &gt;)
      .replaceAll('', &quot;)
      .replaceAll(', &#039;);
  }
})();