var RS = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/referralShare.ts
  var referralShare_exports = {};
  __export(referralShare_exports, {
    buildReferralShareIntent: () => buildReferralShareIntent,
    buildReferralShareMessage: () => buildReferralShareMessage,
    buildReferralShareSubject: () => buildReferralShareSubject,
    copyToClipboard: () => copyToClipboard,
    createReferralInviteCard: () => createReferralInviteCard,
    downloadReferralInviteCard: () => downloadReferralInviteCard,
    referralCardFileName: () => referralCardFileName,
    shareReferralInvite: () => shareReferralInvite
  });

  // src/lib/referralCode.ts
  var REFERRAL_CODE_PREFIX = "GRW";
  var REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  var REFERRAL_CODE_LENGTH = 8;
  var REFERRAL_CODE_GROUP_SIZE = 4;
  var REFERRAL_CODE_PATTERN = new RegExp(
    `^${REFERRAL_CODE_PREFIX}[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`
  );
  var LEGACY_REFERRAL_CODE_PATTERN = /^GRW-[A-Z]{2}-[0-9A-Z]{4,8}$/;
  function normalizeReferralCode(input) {
    if (!input) return "";
    let value = String(input).trim();
    if (!value) return "";
    const fromUrl = value.match(/[?&]ref=([^&#\s]+)/i);
    if (fromUrl) {
      try {
        value = decodeURIComponent(fromUrl[1]);
      } catch {
        value = fromUrl[1];
      }
    }
    return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
  }
  function formatReferralCode(input) {
    const raw = String(input ?? "").trim().toUpperCase();
    if (!raw) return "";
    if (LEGACY_REFERRAL_CODE_PATTERN.test(raw)) return raw;
    const normalized = normalizeReferralCode(raw);
    if (!REFERRAL_CODE_PATTERN.test(normalized)) return normalized || raw;
    const body = normalized.slice(REFERRAL_CODE_PREFIX.length);
    const groups = [];
    for (let i = 0; i < body.length; i += REFERRAL_CODE_GROUP_SIZE) {
      groups.push(body.slice(i, i + REFERRAL_CODE_GROUP_SIZE));
    }
    return [REFERRAL_CODE_PREFIX, ...groups].join("-");
  }
  function buildReferralLink(code, origin) {
    const formatted = formatReferralCode(code);
    if (!formatted) return "";
    const base = (origin || (typeof window !== "undefined" ? window.location.origin : "") || "https://growlancer.vercel.app").replace(/\/+$/, "");
    return `${base}/signup?ref=${encodeURIComponent(formatted)}`;
  }

  // src/lib/referralShare.ts
  var SITE_URL = "https://growlancer.vercel.app";
  var CARD_WIDTH = 1200;
  var CARD_HEIGHT = 630;
  var LOGO_SOURCES = ["/UpdatedLogo.webp", "/UpdatedLogo.png"];
  function resolvedLink(ctx) {
    const code = formatReferralCode(ctx.code);
    if (ctx.link) return ctx.link;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return buildReferralLink(code, origin || SITE_URL);
  }
  function buildReferralShareMessage(ctx) {
    const code = formatReferralCode(ctx.code) || "your invite code";
    const link = resolvedLink(ctx);
    const pitch = ctx.role === "client" ? "Growlanzo is an AI-powered freelancing marketplace: verified freelancers, escrow-protected payments, and matching that fits the brief you post." : ctx.role === "freelancer" ? "Growlanzo is an AI-powered freelancing marketplace: real client work, escrow-protected payments, and projects matched to your skills." : "Growlanzo is an AI-powered freelancing marketplace: verified talent, escrow-protected payments, and matching that fits the brief.";
    const lines = [
      "You're invited to Growlanzo.",
      "",
      pitch,
      "",
      "Use my invite code when you sign up:",
      code,
      "",
      `Join here: ${link}`
    ];
    const name = (ctx.name || "").trim();
    if (name) {
      lines.push("", `Invite from ${name}.`);
    }
    return lines.join("\n");
  }
  function buildReferralShareSubject(ctx) {
    const code = formatReferralCode(ctx.code);
    return code ? `You're invited to Growlanzo \u2014 invite code ${code}` : "You're invited to Growlanzo";
  }
  function buildReferralShareIntent(platform, ctx) {
    const message = buildReferralShareMessage(ctx);
    const link = resolvedLink(ctx);
    if (platform === "linkedin") {
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
    }
    if (platform === "twitter") {
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
    }
    if (platform === "email") {
      return `mailto:?subject=${encodeURIComponent(buildReferralShareSubject(ctx))}&body=${encodeURIComponent(message)}`;
    }
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }
  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
    }
    if (typeof document === "undefined") return false;
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, height / 2, width / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
  function loadImage(src) {
    return new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }
  async function loadBrandLogo() {
    for (const src of LOGO_SOURCES) {
      const image = await loadImage(src);
      if (image) return image;
    }
    return null;
  }
  async function createReferralInviteCard(ctx) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return null;
    const background = ctx2d.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    background.addColorStop(0, "#04140F");
    background.addColorStop(0.55, "#071F18");
    background.addColorStop(1, "#03100C");
    ctx2d.fillStyle = background;
    ctx2d.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    const glow = ctx2d.createRadialGradient(980, 90, 0, 980, 90, 620);
    glow.addColorStop(0, "rgba(16, 185, 129, 0.30)");
    glow.addColorStop(1, "rgba(16, 185, 129, 0)");
    ctx2d.fillStyle = glow;
    ctx2d.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    const logo = await loadBrandLogo();
    const tileSize = 96;
    const tileX = 72;
    const tileY = 56;
    roundedRect(ctx2d, tileX, tileY, tileSize, tileSize, 24);
    ctx2d.fillStyle = "#FFFFFF";
    ctx2d.fill();
    if (logo) {
      const inset = 12;
      const box = tileSize - inset * 2;
      const scale = Math.min(box / logo.width, box / logo.height);
      const drawWidth = logo.width * scale;
      const drawHeight = logo.height * scale;
      ctx2d.save();
      roundedRect(ctx2d, tileX + inset, tileY + inset, box, box, 16);
      ctx2d.clip();
      ctx2d.drawImage(
        logo,
        tileX + (tileSize - drawWidth) / 2,
        tileY + (tileSize - drawHeight) / 2,
        drawWidth,
        drawHeight
      );
      ctx2d.restore();
    } else {
      ctx2d.fillStyle = "#059669";
      ctx2d.font = 'bold 56px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText("G", tileX + tileSize / 2, tileY + tileSize / 2 + 2);
      ctx2d.textAlign = "left";
      ctx2d.textBaseline = "alphabetic";
    }
    ctx2d.fillStyle = "#FFFFFF";
    ctx2d.font = 'bold 38px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx2d.fillText("Growlanzo", 196, 108);
    ctx2d.fillStyle = "rgba(167, 243, 208, 0.85)";
    ctx2d.font = '20px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx2d.fillText("AI-powered freelancing marketplace", 196, 140);
    ctx2d.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(72, 196);
    ctx2d.lineTo(CARD_WIDTH - 72, 196);
    ctx2d.stroke();
    ctx2d.fillStyle = "#FFFFFF";
    ctx2d.font = 'bold 54px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx2d.fillText("You're invited to Growlanzo", 72, 288);
    ctx2d.fillStyle = "rgba(209, 250, 229, 0.78)";
    ctx2d.font = '24px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx2d.fillText("Verified freelancers \xB7 Escrow-protected payments \xB7 AI matching", 72, 330);
    const panelX = 72;
    const panelY = 384;
    const panelWidth = 640;
    const panelHeight = 148;
    roundedRect(ctx2d, panelX, panelY, panelWidth, panelHeight, 24);
    ctx2d.fillStyle = "rgba(16, 185, 129, 0.14)";
    ctx2d.fill();
    ctx2d.strokeStyle = "rgba(16, 185, 129, 0.75)";
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
    ctx2d.fillStyle = "rgba(110, 231, 183, 0.95)";
    ctx2d.font = 'bold 15px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx2d.fillText("Y O U R   I N V I T E   C O D E", panelX + 32, panelY + 44);
    ctx2d.fillStyle = "#FFFFFF";
    ctx2d.font = "bold 56px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx2d.fillText(formatReferralCode(ctx.code) || "GRW-XXXX-XXXX", panelX + 30, panelY + 116);
    const bullets = ["Verified talent", "Escrow-protected work", "AI project matching"];
    ctx2d.font = '22px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    bullets.forEach((line, index) => {
      const y = 420 + index * 44;
      ctx2d.fillStyle = "#10B981";
      ctx2d.beginPath();
      ctx2d.arc(788, y - 7, 7, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.fillStyle = "rgba(236, 253, 245, 0.9)";
      ctx2d.fillText(line, 810, y);
    });
    ctx2d.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx2d.beginPath();
    ctx2d.moveTo(72, 566);
    ctx2d.lineTo(CARD_WIDTH - 72, 566);
    ctx2d.stroke();
    ctx2d.fillStyle = "rgba(148, 163, 184, 0.95)";
    ctx2d.font = '20px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx2d.fillText("growlanzo.com/signup", 72, 606);
    const name = (ctx.name || "").trim();
    if (name) {
      ctx2d.textAlign = "right";
      ctx2d.fillStyle = "rgba(167, 243, 208, 0.9)";
      ctx2d.fillText(`Invite from ${name.slice(0, 48)}`, CARD_WIDTH - 72, 606);
      ctx2d.textAlign = "left";
    }
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
    });
  }
  function referralCardFileName(code) {
    const safe = formatReferralCode(code).replace(/[^0-9A-Z-]/gi, "") || "invite";
    return `growlancer-invite-${safe}.png`;
  }
  function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4e3);
  }
  async function downloadReferralInviteCard(ctx) {
    const blob = await createReferralInviteCard(ctx);
    if (!blob || typeof document === "undefined") return false;
    triggerDownload(blob, referralCardFileName(ctx.code));
    return true;
  }
  async function shareReferralInvite(ctx, prebuiltCard) {
    const message = buildReferralShareMessage(ctx);
    const card = prebuiltCard ?? await createReferralInviteCard(ctx);
    if (card && typeof File !== "undefined" && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([card], referralCardFileName(ctx.code), { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: buildReferralShareSubject(ctx),
            text: message
          });
          return "shared";
        } catch (error) {
          if (error?.name === "AbortError") return "cancelled";
        }
      }
    }
    const copied = await copyToClipboard(message);
    if (card) {
      triggerDownload(card, referralCardFileName(ctx.code));
      return "downloaded";
    }
    return copied ? "copied" : "failed";
  }
  return __toCommonJS(referralShare_exports);
})();
