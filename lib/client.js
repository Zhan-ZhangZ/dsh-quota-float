/**
 * dsh-quota-float — 模型额度浮标（浏览器端 bundle）
 *
 * 形态与 @deepseek-ai/dsh-client-ui-goal 相同：
 *  - window.__ModuleLoader__.load({ id, factory }) 注册工厂；
 *  - 工厂导出 apply(ctx) 与 inject（客户端服务名）；
 *  - 宿主 Loader 通过 package.json 的 dsh.client 声明发现本 bundle。
 *
 * 能力：
 *  1. shell.overlay 悬浮卡片：显示各模型平台余额/套餐配额，可拖拽、边缘吸附、
 *     透明度调节、折叠/展开、手动/定时刷新；
 *  2. 自动跟随当前会话模型：读取 modelSelection 投影，把匹配平台的卡片置顶高亮；
 *  3. settings.section 设置页：自定义卡片（平台、名称、密钥、匹配的 DSH provider）、
 *     刷新频率、透明度、显示开关、位置重置；
 *  4. 查询引擎：浏览器直连各官方余额/配额端点（与本地 quota-dashboard 相同端点，
 *     官方 GET 端点均已开 CORS），30 秒/卡片 限速。
 */
window.__ModuleLoader__.load({
	id: "dsh-quota-float",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		const {
			useState,
			useEffect,
			useRef,
			useMemo,
			useCallback,
			useSyncExternalStore
		} = react;
		const h = react.createElement;
		const Fr = react.Fragment;

		/* ================================================================
		 * ⚠️ 密钥种子（来自个人 Obsidian 密钥库，2026-09-29 快照）
		 * 仅在 localStorage 无本插件历史数据时作为初始卡片写入一次；
		 * 之后完全由设置页管理。本文件含敏感密钥：
		 * 禁止 push 到任何公开仓库、禁止分享、禁止截图外发。
		 * ================================================================ */
		/* 首次使用的示例卡片（不含任何密钥：请在 设置 → 额度浮标 填入你自己的 API Key）。
   密钥仅保存在你本机浏览器的 localStorage，不会上传到任何地方。 */
		const SEED_CARDS = [
			{
				id: "seed-deepseek",
				providerId: "deepseek",
				name: "DeepSeek",
				apiKey: "",
				matchProviders: ["deepseek"],
				enabled: false
			},
			{
				id: "seed-glm",
				providerId: "glm",
				name: "GLM · Coding Plan",
				apiKey: "",
				matchProviders: ["gml", "zai-coding-cn"],
				enabled: false
			},
			{
				id: "seed-minimax",
				providerId: "minimax",
				name: "MiniMax · Token Plan",
				apiKey: "",
				matchProviders: ["minimax", "minimax-cn"],
				enabled: false
			}
		];

		/** Dictionary namespace owned by this plugin. */
		const NS = "quotaFloat";
		/** localStorage persist key (root scope → no suffix)。v2：修 NaN/种子调整后重置。 */
		const PERSIST_KEY = "dsh-quota-float-v2";
		/** 同卡片两次查询的最小间隔。 */
		const MIN_GAP_MS = 30 * 1000;
		/** 请求超时。 */
		const TIMEOUT_MS = 15000;
		/** 拖拽释放时距边缘小于该值则吸附。 */
		const SNAP_THRESHOLD = 56;
		/** 吸附后与边缘的留白。 */
		const SNAP_MARGIN = 10;

		/* ================================================================
		 * Locale
		 * ================================================================ */
		const zh = {
			"nav": "额度浮标",
			"title": "模型额度",
			"follow": "跟随",
			"noFollow": "未匹配",
			"refresh": "立即刷新",
			"collapse": "折叠",
			"expand": "展开",
			"dragHint": "拖动移动 · 松手靠边吸附 · 缩小后 1 秒自动贴边",
			"settings.title": "模型额度浮标",
			"settings.desc": "在对话页悬浮显示各模型平台的余额 / 套餐配额。密钥仅保存在本机浏览器 localStorage，不会上传。",
			"settings.cards": "额度卡片",
			"settings.addCard": "添加卡片",
			"settings.cardName": "名称",
			"settings.cardProvider": "平台",
			"settings.cardKey": "API 密钥",
			"settings.cardKeyShow": "显示",
			"settings.cardKeyHide": "隐藏",
			"settings.cardMatch": "匹配 DSH Provider（用于跟随当前会话模型）",
			"settings.cardEnabled": "启用",
			"settings.cardDelete": "删除",
			"settings.cardQuery": "测试查询",
			"settings.display": "显示选项",
			"settings.autoFollow": "自动跟随当前会话模型（匹配卡片置顶高亮）",
			"settings.showAll": "展开时显示全部启用卡片（关闭则只看跟随 + 常驻卡片）",
			"settings.pinned": "常驻",
			"settings.refresh": "自动刷新频率",
			"settings.refresh.off": "关闭",
			"settings.opacity": "不透明度",
			"settings.liquidGlass": "液态玻璃风格（预设材质，开启后锁定透明度）",
			"settings.resetPos": "重置位置",
			"settings.resetDone": "已重置",
			"settings.done": "完成",
			"status.ok": "正常",
			"status.warn": "异常",
			"status.bad": "失败",
			"status.unknown": "未知",
			"keyInvalid": "密钥失效",
			"ago.now": "刚刚",
			"meter.left": "剩",
			"provider.deepseek": "DeepSeek（余额）",
			"provider.kimi": "Kimi 月之暗面（余额）",
			"provider.glm": "GLM 智谱（5h/周配额）",
			"provider.minimax": "MiniMax 海螺（令牌套餐）",
			"provider.qwen": "Qwen 百炼（探活）",
			"provider.ark": "火山 ARK（探活）",
			"fetching": "查询中…",
			"empty": "暂无卡片，请到 设置 → 额度浮标 添加"
		};
		const en = {
			"nav": "Quota Float",
			"title": "Model Quota",
			"follow": "Following",
			"noFollow": "No match",
			"refresh": "Refresh now",
			"collapse": "Collapse",
			"expand": "Expand",
			"dragHint": "Drag to move · release near an edge to dock · collapses to the edge after 1s",
			"settings.title": "Quota Float",
			"settings.desc": "Floating widget on the conversation page showing model balances / plan quotas. Keys stay in this browser's localStorage only.",
			"settings.cards": "Cards",
			"settings.addCard": "Add card",
			"settings.cardName": "Name",
			"settings.cardProvider": "Provider",
			"settings.cardKey": "API key",
			"settings.cardKeyShow": "Show",
			"settings.cardKeyHide": "Hide",
			"settings.cardMatch": "Match DSH providers (for following the current session model)",
			"settings.cardEnabled": "Enabled",
			"settings.cardDelete": "Delete",
			"settings.cardQuery": "Test query",
			"settings.display": "Display options",
			"settings.autoFollow": "Follow current session model (pin & highlight matching card)",
			"settings.showAll": "Show every enabled card when expanded (off = follow + pinned only)",
			"settings.pinned": "Pinned",
			"settings.refresh": "Auto refresh",
			"settings.refresh.off": "Off",
			"settings.opacity": "Opacity",
			"settings.liquidGlass": "Liquid Glass style (preset material; locks opacity while on)",
			"settings.resetPos": "Reset position",
			"settings.resetDone": "Reset",
			"settings.done": "Done",
			"status.ok": "OK",
			"status.warn": "Degraded",
			"status.bad": "Failed",
			"status.unknown": "Unknown",
			"keyInvalid": "Key invalid",
			"ago.now": "just now",
			"meter.left": "left",
			"provider.deepseek": "DeepSeek (balance)",
			"provider.kimi": "Kimi Moonshot (balance)",
			"provider.glm": "GLM Zhipu (5h/weekly quota)",
			"provider.minimax": "MiniMax (token plan)",
			"provider.qwen": "Qwen DashScope (probe)",
			"provider.ark": "Volcano ARK (probe)",
			"fetching": "Querying…",
			"empty": "No cards yet — add one in Settings → Quota Float"
		};

		/* ================================================================
		 * Utils
		 * ================================================================ */
		const two = (n) => String(n).padStart(2, "0");
		function fmtCNY(n) {
			if (n == null || isNaN(n)) return "—";
			return (n < 0 ? "−¥" : "¥") + Math.abs(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		}
		function fmtInt(n) {
			return (n || 0).toLocaleString("zh-CN");
		}
		function fmtDT(ms) {
			if (!ms || !Number.isFinite(ms)) return "—";
			const d = new Date(ms);
			if (isNaN(d.getTime())) return "—";
			return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
		}
		function fmtRel(ms, now) {
			if (!ms || !Number.isFinite(ms) || !Number.isFinite(now)) return "";
			let s = Math.max(0, Math.round((ms - now) / 1000));
			if (!Number.isFinite(s)) return "";
			const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
			if (d > 0) return `${d}天${hh}小时`;
			if (hh > 0) return `${hh}小时${mm}分`;
			return `${mm}分钟`;
		}
		function fmtAgo(ms, now) {
			if (!ms) return "—";
			const s = Math.max(0, Math.round((now - ms) / 1000));
			if (s < 60) return null; /* "刚刚" */
			const mm = Math.floor(s / 60);
			if (mm < 60) return `${mm}分前`;
			const hh = Math.floor(mm / 60);
			if (hh < 24) return `${hh}小时前`;
			return `${Math.floor(hh / 24)}天前`;
		}
		function maskKey(k) {
			if (!k || k.length < 15) return k || "";
			return k.slice(0, 10) + "…" + k.slice(-4);
		}
		function uid() {
			return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		}

		/* ================================================================
		 * Provider registry + parsers（移植自 quota-dashboard providers.js）
		 * ================================================================ */
		function parseDeepSeek(j) {
			const bi = (j.balance_infos || []).find((b) => b.currency === "CNY") || (j.balance_infos || [])[0] || {};
			const total = parseFloat(bi.total_balance ?? bi.topped_up_balance);
			const grant = parseFloat(bi.granted_balance) || 0;
			const topup = parseFloat(bi.topped_up_balance) || (isNaN(total) ? 0 : total - grant);
			const ok = j.is_available === true;
			return {
				status: ok ? "ok" : "bad",
				primary: isNaN(total) ? "—" : fmtCNY(total),
				kind: "balance",
				subLines: [
					{ label: "充值", value: isNaN(total) ? "—" : fmtCNY(topup) },
					{ label: "赠金", value: fmtCNY(grant) }
				]
			};
		}
		function parseKimi(j) {
			const avail = parseFloat(j.available_balance ?? j.data?.available_balance);
			const cash = parseFloat(j.cash_balance ?? j.data?.cash_balance) || 0;
			const voucher = parseFloat(j.voucher_balance ?? j.data?.voucher_balance) || 0;
			const ok = !isNaN(avail) && avail >= 0;
			return {
				status: ok ? "ok" : "warn",
				primary: isNaN(avail) ? "—" : "¥" + avail.toFixed(2),
				kind: "balance",
				subLines: [
					{ label: "现金", value: "¥" + cash.toFixed(2) },
					{ label: "代金券", value: "¥" + voucher.toFixed(2) }
				]
			};
		}
		function parseGLM(j, ctx, now) {
			const lim = (j.data && j.data.limits) || j.limits || [];
			const f = lim.find((l) => l.unit === 3 && l.number === 5) || lim[0] || {};
			const w = lim.find((l) => l.unit === 6) || lim[1] || {};
			const level = (j.data && j.data.level) || j.level || "pro";
			const meters = [];
			if (f.usage != null) {
				meters.push({
					name: "5 小时窗口",
					pctUsed: Math.min(100, Math.round(f.percentage ?? ((f.currentValue / f.usage) * 100))),
					sub: f.nextResetTime ? `重置 ${fmtDT(f.nextResetTime)} · 距 ${fmtRel(f.nextResetTime, now)}` : ""
				});
			}
			if (w.usage != null) {
				meters.push({
					name: "周窗口",
					pctUsed: Math.min(100, Math.round(w.percentage ?? ((w.currentValue / w.usage) * 100))),
					sub: w.nextResetTime ? `重置 ${fmtDT(w.nextResetTime)} · 距 ${fmtRel(w.nextResetTime, now)}` : ""
				});
			}
			return {
				status: meters.length ? "ok" : "warn",
				primary: meters.length ? `${meters[0].pctUsed}%` : "—",
				kind: "meters",
				head: `GLM · ${String(level).toUpperCase()}`,
				subLines: [{ label: "订阅等级", value: level }],
				meters
			};
		}
		function parseMiniMax(j, ctx, now) {
			const br = j.base_resp || (j.data && j.data.base_resp) || {};
			if (br.status_code != null && br.status_code !== 0) {
				return {
					status: "bad",
					primary: "—",
					kind: "meters",
					subLines: [{ label: "API", value: `${br.status_code} ${br.status_msg || ""}` }],
					meters: []
				};
			}
			const arr = j.model_remains || (j.data && j.data.model_remains) || (j.result && j.result.model_remains) || [];
			const KNOWN = { general: "文本 / 编程", video: "视频生成", image: "图像生成", speech: "语音合成", music: "音乐生成" };
			const labelFor = (name) => KNOWN[name] || name;
			function remaining(m, pctField, totalField, usageField, remainingField) {
				const pct = m[pctField];
				if (pct != null) {
					const total = m[totalField];
					if (typeof total === "number" && total > 0) {
						const rem = Math.round((total * pct) / 100);
						return { pct, label: `剩 ${fmtInt(rem)} / ${fmtInt(total)}` };
					}
					return { pct, label: null };
				}
				const total = m[totalField];
				const rawRem = m[remainingField] != null ? m[remainingField] : m[usageField] != null ? m[usageField] : null;
				if (typeof total === "number" && total > 0 && typeof rawRem === "number") {
					const rem = Math.max(0, Math.min(total, rawRem));
					return { pct: Math.round((rem / total) * 100), label: `剩 ${fmtInt(rem)} / ${fmtInt(total)}` };
				}
				return { pct: null, label: null };
			}
			const meters = [];
			for (const m of arr) {
				const lbl = labelFor(m.model_name || "?");
				const i = remaining(m, "current_interval_remaining_percent", "current_interval_total_count", "current_interval_usage_count", "current_interval_remaining_count");
				if (i.pct != null) {
					const parts = [];
					if (i.label) parts.push(i.label);
					if (m.end_time) parts.push(`窗口止 ${fmtDT(m.end_time)} · 距 ${fmtRel(m.end_time, now)}`);
					else if (m.remains_time) parts.push(`剩 ${m.remains_time}`);
					meters.push({ name: `${lbl} · 5h`, pctUsed: Math.max(0, Math.min(100, 100 - i.pct)), sub: parts.join(" · ") });
				}
				const wk = remaining(m, "current_weekly_remaining_percent", "current_weekly_total_count", "current_weekly_usage_count", "current_weekly_remaining_count");
				if (wk.pct != null) {
					const parts = [];
					if (wk.label) parts.push(wk.label);
					if (m.weekly_end_time) parts.push(`周期止 ${fmtDT(m.weekly_end_time)} · 距 ${fmtRel(m.weekly_end_time, now)}`);
					if (m.weekly_boost_permille) parts.push((m.weekly_boost_permille / 1000).toFixed(1) + "× 加成");
					meters.push({ name: `${lbl} · 周`, pctUsed: Math.max(0, Math.min(100, 100 - wk.pct)), sub: parts.join(" · ") });
				}
			}
			return {
				status: meters.length ? "ok" : "warn",
				primary: meters.length ? `${meters[0].pctUsed}%` : "—",
				kind: "meters",
				head: "MiniMax · Token Plan",
				subLines: arr.length ? [{ label: "模型桶", value: `${arr.length} 个` }] : [],
				meters
			};
		}
		function parseProbeOk(ctx) {
			return {
				status: "ok",
				primary: "✓ 可用",
				kind: "probe",
				subLines: [
					{ label: "HTTP", value: "200" },
					{ label: "延迟", value: `${ctx.latencyMs || 0} ms` }
				]
			};
		}

		const PROVIDERS = {
			deepseek: {
				id: "deepseek",
				request: { method: "GET", url: "https://api.deepseek.com/user/balance" },
				parse: parseDeepSeek
			},
			kimi: {
				id: "kimi",
				request: { method: "GET", url: "https://api.moonshot.cn/v1/users/me/balance" },
				parse: parseKimi
			},
			glm: {
				id: "glm",
				request: { method: "GET", url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit" },
				parse: parseGLM
			},
			minimax: {
				id: "minimax",
				request: { method: "GET", url: "https://api.minimaxi.com/v1/token_plan/remains" },
				parse: parseMiniMax
			},
			qwen: {
				id: "qwen",
				/* dashscope coding 端点 CORS 预检 401，必须走宿主代理 */
				hostProxy: true,
				request: {
					method: "POST",
					url: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
					body: { model: "qwen3.7-plus", messages: [{ role: "user", content: "ping" }], max_tokens: 5 }
				},
				parse: parseProbeOk
			},
			ark: {
				id: "ark",
				/* ARK CORS 不允许 authorization 头，走宿主代理 */
				hostProxy: true,
				request: {
					method: "POST",
					url: "https://ark.cn-beijing.volces.com/api/coding/v3/responses",
					body: { model: "doubao-seed-2.0-code", input: "ping", max_output_tokens: 16 }
				},
				parse: parseProbeOk
			}
		};
		const PROVIDER_ORDER = ["deepseek", "glm", "minimax", "kimi", "qwen", "ark"];
		/** 宿主半注册的同源代理路由（lib/index.js；desktop 前置层仅转发 GET）。 */
		const PROXY_PATH = "/quota-float-proxy";

		/* ================================================================
		 * Query engine（移植自 quota-dashboard query-engine.js，简化）
		 * 直连优先；hostProxy 或直连遭遇 CORS/网络 TypeError 时走宿主代理。
		 * ================================================================ */
		async function fetchViaProxy(card, signal) {
			const resp = await fetch(`${PROXY_PATH}?providerId=${encodeURIComponent(card.providerId)}&apiKey=${encodeURIComponent(card.apiKey)}`, { signal });
			if (!resp.ok) {
				const env = await resp.json().catch(() => ({}));
				throw new Error(`代理 ${resp.status}${env.error ? "：" + env.error : ""}`);
			}
			const envelope = await resp.json();
			if (envelope.status !== 200) throw new Error("HTTP " + envelope.status);
			return envelope.body ?? "";
		}
		async function queryOnce(card) {
			const provider = PROVIDERS[card.providerId];
			if (!provider || !card.apiKey) {
				return { ok: false, status: "warn", primary: "—", kind: "unknown", subLines: [], meters: [], error: !provider ? "未知平台" : "缺少密钥" };
			}
			const c = new AbortController();
			const timer = setTimeout(() => c.abort(), TIMEOUT_MS + 8000);
			try {
				const t0 = performance.now();
				let bodyText = null;
				let httpStatus = 200;
				if (!provider.hostProxy) {
					try {
						const headers = { "Content-Type": "application/json", Authorization: "Bearer " + card.apiKey };
						const opts = { method: provider.request.method, headers, signal: c.signal };
						if (provider.request.body && provider.request.method === "POST") opts.body = JSON.stringify(provider.request.body);
						const resp = await fetch(provider.request.url, opts);
						httpStatus = resp.status;
						bodyText = await resp.text();
					} catch (directError) {
						/* CORS / 网络失败（TypeError）→ 回退宿主代理 */
						if (!(directError instanceof TypeError)) throw directError;
						bodyText = await fetchViaProxy(card, c.signal);
						httpStatus = 200;
					}
				} else {
					bodyText = await fetchViaProxy(card, c.signal);
				}
				const latencyMs = Math.round(performance.now() - t0);
				if (httpStatus !== 200) throw new Error("HTTP " + httpStatus);
				let j = null;
				try {
					j = JSON.parse(bodyText);
				} catch {
					if (bodyText) {
						return { ok: true, status: "ok", primary: "✓ 可用", kind: "probe", subLines: [{ label: "HTTP", value: httpStatus + " · " + latencyMs + "ms" }], meters: [], latencyMs };
					}
					throw new Error("响应不是 JSON");
				}
				const parsed = provider.parse(j, { card, latencyMs }, Date.now());
				return Object.assign({ ok: true, latencyMs, meters: [], subLines: [] }, parsed);
			} catch (e) {
				return {
					ok: false,
					status: "warn",
					primary: "—",
					kind: provider.parse === parseProbeOk ? "probe" : "unknown",
					subLines: [],
					meters: [],
					error: String(e?.message || e || "请求失败").slice(0, 120)
				};
			} finally {
				clearTimeout(timer);
			}
		}

		/** 引擎：绑定 store 实例，负责限速、并发与写入。 */
		function createEngine(instance) {
			let running = false;
			const inFlight = new Set();
			async function refreshCard(card, force) {
				const now = Date.now();
				const data = card.data;
				if (!force && data?.fetchedAt && now - data.fetchedAt < MIN_GAP_MS) return;
				if (inFlight.has(card.id)) return;
				inFlight.add(card.id);
				try {
					const result = await queryOnce(card);
					instance.actions.setCardData(card.id, Object.assign({ fetchedAt: Date.now() }, result));
				} finally {
					inFlight.delete(card.id);
				}
			}
			async function refreshAll(force) {
				if (running) return;
				running = true;
				try {
					const cards = instance.getSnapshot().cards.filter((c) => c.enabled && c.apiKey && PROVIDERS[c.providerId]);
					await Promise.allSettled(cards.map((c) => refreshCard(c, force)));
				} finally {
					running = false;
				}
			}
			return {
				refreshAll,
				refreshCard,
				isBusy: () => inFlight.size > 0 || running
			};
		}

		/* ================================================================
		 * Persisted store
		 * ================================================================ */
		function defaultUi() {
			return {
				autoFollow: true,
				showAll: true,
				refreshMs: 5 * 60 * 1000,
				opacity: 0.96,
				liquidGlass: false, /* 液态玻璃预设风格：开启时锁定透明度 */
				pos: null,
				collapsed: false,
				edge: null /* "left" | "right" 贴边停靠 */
			};
		}
		function defaultState() {
			return {
				version: 2,
				cards: SEED_CARDS.map((c) => Object.assign({}, c, { data: null })),
				ui: defaultUi()
			};
		}
		function createStoreHandle() {
			return _dsh_client_store.defineStore({
				init: defaultState,
				persist: PERSIST_KEY,
				actions: {
					setUi(d, patch) {
						Object.assign(d.ui, patch);
					},
					upsertCard(d, card) {
						const i = d.cards.findIndex((c) => c.id === card.id);
						if (i >= 0) d.cards[i] = card;
						else d.cards.push(card);
					},
					patchCard(d, id, patch) {
						const c = d.cards.find((x) => x.id === id);
						if (c) Object.assign(c, patch);
					},
					setCardData(d, id, data) {
						const c = d.cards.find((x) => x.id === id);
						if (c) c.data = data;
					},
					removeCard(d, id) {
						d.cards = d.cards.filter((c) => c.id !== id);
					},
					resetUi(d) {
						d.ui = defaultUi();
					}
				}
			});
		}

		/* ================================================================
		 * Hooks
		 * ================================================================ */
		/** 每 intervalMs 拍一次的时钟（用于倒计时 / 相对时间）。 */
		function useNow(intervalMs) {
			const [now, setNow] = useState(() => Date.now());
			useEffect(() => {
				const id = setInterval(() => setNow(Date.now()), intervalMs);
				return () => clearInterval(id);
			}, [intervalMs]);
			return now;
		}
		/** 当前主会话 binding（uiSession.current 源）。 */
		function useCurrentBinding(current) {
			return useSyncExternalStore(
				useCallback((cb) => current.subscribe(cb), [current]),
				useCallback(() => current.getSnapshot(), [current])
			);
		}
		/** 当前会话选中的模型 {provider, model}（modelSelection 投影）。 */
		function useSessionModel(binding) {
			const session = binding && binding.key !== undefined ? binding.hooks?.session : undefined;
			const projection = session?.projections?.faceOf?.("modelSelection");
			const source = useMemo(() => projection ?? null, [projection]);
			const subscribe = useCallback((cb) => (source ? source.subscribe(cb) : () => {}), [source]);
			const getSnapshot = useCallback(() => (source ? (source.getSnapshot() ?? null) : null), [source]);
			return useSyncExternalStore(subscribe, getSnapshot);
		}

		/* ================================================================
		 * Styles
		 * ================================================================ */
		const CSS_TAG = "dsh-quota-float/styles.css";
		const css = `
.qf-root{position:absolute;z-index:5;pointer-events:auto;font-size:12px;color:var(--dsw-alias-label-primary);opacity:var(--qf-o,.96);transition:opacity .15s ease}
.qf-root[data-dragging="true"]{transition:none;cursor:grabbing;opacity:1}
.qf-root:not([data-dragging="true"]):hover{opacity:1}
/* 拖动透明度滑杆时豁免“悬停恢复不透明”，让调节即时可见 */
.qf-root:has(input[type="range"]:active){opacity:var(--qf-o,.96) !important}
.qf-root[data-anim="true"]{transition:left .18s ease,top .18s ease,opacity .15s ease}
.qf-card{min-width:216px;max-width:300px;transform-origin:0 0;border-radius:var(--dsw-radius-md);overflow:hidden;position:relative;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel)}
.qf-head{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}
.qf-head:active{cursor:grabbing}
.qf-grip{color:var(--dsw-alias-label-tertiary);letter-spacing:-1px;line-height:10px;font-size:11px;flex:none}
.qf-title{font-weight:600;font-size:12px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qf-follow{font-size:10px;color:var(--dsw-alias-state-business-primary);max-width:96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}
.qf-iconBtn{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;width:22px;height:22px;border-radius:var(--dsw-radius-sm);display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0;flex:none}
.qf-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.qf-iconBtn[data-busy="true"] .qf-spin{display:inline-block;animation:qf-rot 1s linear infinite}
@keyframes qf-rot{to{transform:rotate(360deg)}}
.qf-body{padding:2px 8px 8px;display:flex;flex-direction:column;gap:6px;max-height:min(46vh,420px);overflow:auto}
.qf-row{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:5px 8px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent)}
.qf-row[data-match="true"]{border-color:var(--dsw-alias-state-business-primary)}
.qf-rowTop{display:flex;align-items:center;gap:6px}
.qf-dot{width:7px;height:7px;border-radius:50%;flex:none}
.qf-dot[data-s="ok"]{background:var(--dsw-alias-state-success-primary,#3fb950)}
.qf-dot[data-s="warn"]{background:var(--dsw-alias-state-warn-primary,#d29922)}
.qf-dot[data-s="bad"]{background:var(--dsw-alias-state-error-primary,#f85149)}
.qf-dot[data-s="unknown"]{background:var(--dsw-alias-label-tertiary)}
.qf-rowName{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.qf-rowValue{font-weight:700;font-variant-numeric:tabular-nums;flex:none}
.qf-rowAgo{font-size:10px;color:var(--dsw-alias-label-tertiary);flex:none;font-weight:400}
.qf-sub{margin-top:3px;display:flex;flex-direction:column;gap:1px;color:var(--dsw-alias-label-secondary)}
.qf-subLine{display:flex;gap:6px;justify-content:space-between;font-size:11px}
.qf-subLine .qf-subLabel{color:var(--dsw-alias-label-tertiary)}
.qf-meter{margin-top:4px}
.qf-meterName{display:flex;justify-content:space-between;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-bottom:2px;gap:8px}
.qf-bar{height:4px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);overflow:hidden}
.qf-barIn{height:100%;border-radius:2px;transition:width .3s ease}
.qf-barIn[data-lv="ok"]{background:var(--dsw-alias-state-success-primary,#3fb950)}
.qf-barIn[data-lv="warn"]{background:var(--dsw-alias-state-warn-primary,#d29922)}
.qf-barIn[data-lv="bad"]{background:var(--dsw-alias-state-error-primary,#f85149)}
.qf-meterSub{font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qf-foot{display:flex;align-items:center;gap:6px;padding:4px 8px 6px;color:var(--dsw-alias-label-tertiary);font-size:10px}
.qf-foot input[type="range"]{flex:1;accent-color:var(--dsw-alias-state-business-primary);height:14px;margin:0}
.qf-iconBtn[data-on="true"]{color:var(--dsw-alias-state-business-primary)}
.qf-glassLabel{color:var(--dsw-alias-state-business-primary);font-weight:600}
.qf-collapsed{transform-origin:0 0;position:relative;display:flex;align-items:center;gap:6px;padding:5px 8px 5px 6px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel)}
.qf-mini{font-weight:700;font-variant-numeric:tabular-nums}
/* ── 液体玻璃（Liquid Glass）材质：玻璃底 + 渐变高光描边 + 顶部镜面 ──
   手法参考 rdev/liquid-glass-react：backdrop blur+saturate、mask-xor 描边、
   inset specular；纯 CSS 自包含，Chromium 稳定。 */
/* 玻璃开启：预设「完美」材质，锁定不透明度 */
.qf-root[data-glass="true"]{opacity:1 !important}
.qf-root[data-glass="true"] .qf-card,.qf-root[data-glass="true"] .qf-collapsed,.qf-root[data-glass="true"] .qf-edgeTab{
	border-color:transparent;
	background:
		linear-gradient(160deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.04) 32%,rgba(255,255,255,0) 58%),
		linear-gradient(0deg,rgba(127,127,127,.10),rgba(127,127,127,.10)),
		color-mix(in srgb,var(--dsw-alias-bg-base) 46%,transparent);
	-webkit-backdrop-filter:blur(18px) saturate(2.2) brightness(1.03);
	backdrop-filter:blur(18px) saturate(2.2) brightness(1.03);
	box-shadow:
		inset .6px .6px 1.2px rgba(255,255,255,.32),
		inset -.6px -.6px 1.2px rgba(0,0,0,.1),
		0 8px 26px rgba(0,0,0,.2);
}
/* 玻璃专属：动态光斑（跟随指针的镜面高光）+ 细噪点（液体有机感） */
.qf-root[data-glass="true"] .qf-card::before,.qf-root[data-glass="true"] .qf-collapsed::before,.qf-root[data-glass="true"] .qf-edgeTab::before{
	content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:2;
	background:linear-gradient(135deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.32) 50%,rgba(255,255,255,.04) 100%);
	-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
	-webkit-mask-composite:xor;mask-composite:exclude;
	padding:1px;
}
.qf-root[data-glass="true"] .qf-card::after,.qf-root[data-glass="true"] .qf-collapsed::after,.qf-root[data-glass="true"] .qf-edgeTab::after{
	content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:2;
	background:linear-gradient(180deg,rgba(255,255,255,.22) 0%,transparent 9%);
}
.qf-card::before,.qf-collapsed::before,.qf-edgeTab::before,.qf-card::after,.qf-collapsed::after,.qf-edgeTab::after{content:none}
/* 玻璃模式下卡片行也调透，让背景真正透出来 */
.qf-root[data-glass="true"] .qf-row{background:color-mix(in srgb,var(--dsw-alias-bg-base) 52%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-border-l1) 55%,transparent)}

/* ── 贴边停靠侧签：左右吸附后变成半隐藏竖签，悬停/拖拽时探出 ── */
.qf-root[data-edge]{pointer-events:none}
.qf-root[data-edge] .qf-edgeTab{pointer-events:auto}
.qf-edgeTab{display:flex;align-items:center;gap:8px;min-width:132px;max-width:180px;padding:8px 12px;border-radius:999px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .18s ease;position:relative;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel)}
.qf-edgeTabVal{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;flex:1}
.qf-edgeTabGrip{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px}
.qf-root[data-edge="left"] .qf-edgeTab{transform:translateX(calc(-100% + 22px));border-top-left-radius:0;border-bottom-left-radius:0}
.qf-root[data-edge="right"] .qf-edgeTab{transform:translateX(calc(100% - 22px));border-top-right-radius:0;border-bottom-right-radius:0}
.qf-root:hover .qf-edgeTab,.qf-root[data-dragging="true"] .qf-edgeTab{transform:translateX(0)}
.qf-err{color:var(--dsw-alias-state-error-primary);font-size:10.5px;margin-top:2px;word-break:break-all}
.qf-rowProbe{padding:3px 8px;opacity:.92}
/* 拖拽视觉：抓手光标、吸附预告高亮 */
.qf-head{cursor:grab}
.qf-root[data-dragging="true"] .qf-card{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 8px 24px rgba(0,0,0,.22)}
.qf-root[data-dragging="true"] .qf-head{cursor:grabbing}
.qf-root[data-snap="left"] .qf-card,.qf-root[data-snap="right"] .qf-card,.qf-root[data-snap="top"] .qf-card,.qf-root[data-snap="bottom"] .qf-card{outline:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 65%,transparent);outline-offset:2px}
.qf-root[data-snap="left"] .qf-card{border-bottom-left-radius:0}.qf-root[data-snap="right"] .qf-card{border-bottom-right-radius:0}
/* ── 折叠/展开过渡动画（整体 transform 缩放，合成器动画，无布局跳变） ── */
@keyframes qf-card-in{from{transform:scale(.5);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes qf-pop-in{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
.qf-card[data-anim-in="true"]{animation:qf-card-in .18s ease-out}
.qf-collapsed[data-anim-in="true"]{animation:qf-pop-in .16s ease-out}
.qf-card[data-collapsing="true"]{transform:scale(.5);opacity:0;min-width:0;transition:transform .16s ease-in,opacity .16s ease-in,min-width .16s ease-in}
/* ── settings section ── */
.qfs-root{display:flex;flex-direction:column;gap:18px;font-size:13px}
.qfs-desc{color:var(--dsw-alias-label-secondary);line-height:1.6}
.qfs-h{font-weight:600;font-size:13px;margin:0 0 4px}
.qfs-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.qfs-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.qfs-row>label{color:var(--dsw-alias-label-secondary);flex:none;font-size:12px}
.qfs-input,.qfs-select{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);height:28px;padding:0 8px;font-size:12.5px;outline:none;min-width:0}
.qfs-input:focus,.qfs-select:focus{border-color:var(--dsw-alias-state-business-primary)}
.qfs-input{flex:1}
.qfs-name{max-width:180px}
.qfs-btn{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);height:28px;padding:0 12px;font-size:12.5px;cursor:pointer}
.qfs-btn:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.qfs-btn[data-danger="true"]:hover{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.qfs-check{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none}
.qfs-check input{accent-color:var(--dsw-alias-state-business-primary)}
.qfs-match{display:flex;flex-wrap:wrap;gap:6px 14px}
.qfs-note{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.qfs-testResult{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-height:14px}
.qfs-sliderRow{display:flex;align-items:center;gap:10px;max-width:320px}
.qfs-sliderRow input{flex:1;accent-color:var(--dsw-alias-state-business-primary)}
`;
		function ensureStyles() {
			if (typeof document === "undefined") return;
			/* 插件热重载不会移除旧 <style>；按内容比对，变了才替换，避免迭代开发时样式滞留 */
			const existing = document.querySelectorAll(`style[data-plugin-css="${CSS_TAG}"]`);
			if (existing.length === 1 && existing[0].textContent === css) return;
			for (const tag of existing) tag.remove();
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-quota-float";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/* ================================================================
		 * Floating widget
		 * ================================================================ */
		function meterLevel(pctUsed) {
			if (pctUsed == null) return "unknown";
			if (pctUsed < 70) return "ok";
			if (pctUsed < 90) return "warn";
			return "bad";
		}
		function snapPosition(x, y, w, hh) {
			const vw = window.innerWidth, vh = window.innerHeight;
			let nx = x, ny = y;
			if (x < SNAP_THRESHOLD) nx = SNAP_MARGIN;
			else if (x + w > vw - SNAP_THRESHOLD) nx = Math.max(SNAP_MARGIN, vw - w - SNAP_MARGIN);
			if (y < SNAP_THRESHOLD) ny = SNAP_MARGIN;
			else if (y + hh > vh - SNAP_THRESHOLD) ny = Math.max(SNAP_MARGIN, vh - hh - SNAP_MARGIN);
			nx = Math.min(Math.max(nx, SNAP_MARGIN), Math.max(SNAP_MARGIN, vw - w - SNAP_MARGIN));
			ny = Math.min(Math.max(ny, SNAP_MARGIN), Math.max(SNAP_MARGIN, vh - hh - SNAP_MARGIN));
			return { x: Math.round(nx), y: Math.round(ny) };
		}

		function MeterView({ meter }) {
			const lv = meterLevel(meter.pctUsed);
			return h("div", { className: "qf-meter" },
				h("div", { className: "qf-meterName" },
					h("span", null, meter.name),
					h("span", null, `${meter.pctUsed ?? "?"}%`)
				),
				h("div", { className: "qf-bar" },
					h("div", { className: "qf-barIn", "data-lv": lv, style: { width: `${Math.min(100, meter.pctUsed ?? 0)}%` } })
				),
				meter.sub ? h("div", { className: "qf-meterSub" }, meter.sub) : null
			);
		}

		function CardRowView({ card, match, expanded, t, now }) {
			const data = card.data;
			const status = data?.status ?? "unknown";
			const ago = fmtAgo(data?.fetchedAt, now);
			const shortName = card.name || card.providerId;
			/* 探活类（probe）：压缩成单行 —— ✓/✗ + 延迟/错误，不渲染副行 */
			if (data && data.kind === "probe") {
				return h("div", { className: "qf-row qf-rowProbe", "data-match": match ? "true" : undefined, title: data.error || "" },
					h("div", { className: "qf-rowTop" },
						h("span", { className: "qf-dot", "data-s": status }),
						h("span", { className: "qf-rowName" }, shortName),
						h("span", { className: "qf-rowValue" }, data.ok ? (data.subLines?.[1]?.value ? `✓ ${data.subLines[1].value}` : "✓") : "✗"),
						h("span", { className: "qf-rowAgo" }, ago === null ? t("ago.now") : ago)
					),
					!data.ok && data.error ? h("div", { className: "qf-err" }, data.error.slice(0, 60)) : null
				);
			}
			/* 余额/配额类失败（密钥失效、网络失败）：单行 + 简短原因 */
			const authFail = data && !data.ok && /401|403|key|unauthor/i.test(data.error || "");
			return h("div", { className: "qf-row", "data-match": match ? "true" : undefined },
				h("div", { className: "qf-rowTop" },
					h("span", { className: "qf-dot", "data-s": status, title: t(`status.${status}`) }),
					h("span", { className: "qf-rowName", title: `${shortName} · ${maskKey(card.apiKey)}` }, shortName),
					h("span", { className: "qf-rowValue" }, data ? (authFail ? t("keyInvalid") : data.primary) : "…"),
					h("span", { className: "qf-rowAgo" }, ago === null ? t("ago.now") : ago)
				),
				expanded && data?.subLines?.length ? h("div", { className: "qf-sub" },
					data.subLines.map((s, i) => h("div", { className: "qf-subLine", key: i },
						h("span", { className: "qf-subLabel" }, s.label), h("span", null, s.value)
					))
				) : null,
				expanded && data?.meters?.length ? data.meters.map((m, i) => h(MeterView, { meter: m, key: i })) : null,
				expanded && data?.error ? h("div", { className: "qf-err" }, data.error) : null
			);
		}

		/**
		 * 渲染错误边界：本插件崩溃时只隐藏自身，绝不拖垮整个 shell
		 * （曾经因 TDZ 引用导致整页空白，教训）。 */
		class SafeBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				try { console.error("[quota-float] render failed:", error); } catch {}
			}
			render() {
				return this.state.failed ? null : this.props.children;
			}
		}

		/**
		 * 浮标主体。props: { instance, engine, current, t }
		 * - current: uiSession.current 源（跟随主会话模型）
		 */
		function QuotaFloatWidget(props) {
			const { instance, engine, current, t } = props;
			ensureStyles();
			const state = useSyncExternalStore(
				useCallback((cb) => instance.subscribe(cb), [instance]),
				useCallback(() => instance.getSnapshot(), [instance])
			);
			const ui = state.ui;
			const binding = useCurrentBinding(current);
			const modelSel = useSessionModel(binding);
			const now = useNow(30000);
			const ref = useRef(null);
			const [busy, setBusy] = useState(false);
			const [live, setLive] = useState(null); /* 拖拽中的 {x,y} */
			const dragRef = useRef(null);

			const currentModel = modelSel?.next ?? null;
			const currentProvider = currentModel?.provider;

			/* 可见卡片：跟随匹配优先，其次常驻，showAll 时全部启用卡片 */
			const cards = useMemo(() => {
				const enabled = state.cards.filter((c) => c.enabled);
				const matchId = ui.autoFollow && currentProvider
					? enabled.find((c) => (c.matchProviders || []).includes(currentProvider))?.id
					: undefined;
				const rest = ui.showAll || !ui.autoFollow
					? enabled
					: enabled.filter((c) => !matchId || c.id === matchId);
				const ordered = matchId
					? [...enabled.filter((c) => c.id === matchId), ...rest.filter((c) => c.id !== matchId)]
					: rest;
				return { list: ordered, matchId };
			}, [state.cards, ui.autoFollow, ui.showAll, currentProvider]);

			/* 定时刷新 + 挂载即查一次 */
			useEffect(() => {
				if (!ui.refreshMs) return;
				const id = setInterval(() => {
					engine.refreshAll(false);
				}, ui.refreshMs);
				return () => clearInterval(id);
			}, [ui.refreshMs, engine]);
			useEffect(() => {
				let alive = true;
				setBusy(true);
				engine.refreshAll(false).finally(() => { if (alive) setBusy(false); });
				return () => { alive = false; };
			}, [engine]);

			/* 有位置时随窗口收缩夹取 */
			useEffect(() => {
				if (!ui.pos) return;
				const onResize = () => {
					const el = ref.current;
					if (!el) return;
					const rect = el.getBoundingClientRect();
					const snapped = snapPosition(ui.pos.x, ui.pos.y, rect.width, rect.height);
					if (snapped.x !== ui.pos.x || snapped.y !== ui.pos.y) instance.actions.setUi({ pos: snapped });
				};
				window.addEventListener("resize", onResize);
				return () => window.removeEventListener("resize", onResize);
			}, [ui.pos, instance]);

			const manualRefresh = useCallback(() => {
				setBusy(true);
				engine.refreshAll(true).finally(() => setBusy(false));
			}, [engine]);

			/* 拖拽：pointer capture 绑定在“手柄元素”自身（事件与监听同元素，快速移动不丢）；
			   移动阈值 4px 区分点击；交互控件（按钮等）不启动拖拽；
			   释放时靠边吸附 + 持久化；拖拽中靠近边缘显示吸附预告。 */
			const [dragging, setDragging] = useState(false);
			const [snapHint, setSnapHint] = useState(null); /* "left"|"right"|"top"|"bottom"|null */
			const [hovered, setHovered] = useState(false);
			/* 自动贴边只武装一次：显式缩小时置位；触发、手动拖动或展开后解除。
			   此前每次拖离边缘都会重新武装定时器，形成"伸手去抓就窜回边缘"的循环。 */
			const dockOnceRef = useRef(false);

			/* 折叠后 1 秒自动贴边停靠（最近的左/右边缘）；悬停、拖拽或已解除武装则不动作。 */
			useEffect(() => {
				if (!ui.collapsed || ui.edge || dragging || hovered || !dockOnceRef.current) return;
				const vw = window.innerWidth, vh = window.innerHeight;
				const fallbackX = vw - 140;
				const currentX = ui.pos?.x ?? fallbackX;
				const edge = currentX + 60 < vw / 2 ? "left" : "right";
				const timer = window.setTimeout(() => {
					if (dockOnceRef.current && !dragging && !hovered) {
						dockOnceRef.current = false;
						instance.actions.setUi({
							edge,
							pos: {
								x: Math.round(ui.pos?.x ?? fallbackX),
								y: Math.round(ui.pos?.y ?? Math.max(80, vh - 220))
							}
						});
					}
				}, 1000);
				return () => window.clearTimeout(timer);
			}, [ui.collapsed, ui.edge, ui.pos, dragging, hovered, instance]);
			const onPointerDown = useCallback((e) => {
				if (e.button !== 0) return;
				/* 仅排除手柄内部的交互控件；手柄自身（如折叠药丸根元素）必须可拖 */
				const hit = e.target?.closest?.("button,input,select,a");
				if (hit && hit !== e.currentTarget) return;
				const el = ref.current;
				if (!el) return;
				const rect = el.getBoundingClientRect();
				dragRef.current = {
					px: e.clientX, py: e.clientY,
					x: rect.left, y: rect.top, w: rect.width, h: rect.height,
					moved: false, id: e.pointerId
				};
				/* capture 绑在事件所在元素（手柄），后续 move/up 均派发到手柄 */
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
				e.preventDefault();
			}, []);
			const onPointerMove = useCallback((e) => {
				const d = dragRef.current;
				if (!d || e.pointerId !== d.id) return;
				const dx = e.clientX - d.px, dy = e.clientY - d.py;
				if (!d.moved) {
					if (Math.hypot(dx, dy) < 4) return;
					d.moved = true;
					setDragging(true);
				}
				const vw = window.innerWidth, vh = window.innerHeight;
				const nx = Math.min(Math.max(d.x + dx, 0), Math.max(0, vw - d.w));
				const ny = Math.min(Math.max(d.y + dy, 0), Math.max(0, vh - d.h));
				setLive({ x: Math.round(nx), y: Math.round(ny) });
				/* 吸附预告：距某条边进入阈值范围 */
				let hint = null;
				if (nx < SNAP_THRESHOLD) hint = "left";
				else if (nx + d.w > vw - SNAP_THRESHOLD) hint = "right";
				else if (ny < SNAP_THRESHOLD) hint = "top";
				else if (ny + d.h > vh - SNAP_THRESHOLD) hint = "bottom";
				setSnapHint(hint);
			}, []);
			const endDrag = useCallback((e, clickAction) => {
				const d = dragRef.current;
				if (!d || (e && e.pointerId !== d.id)) return;
				dragRef.current = null;
				try { e?.currentTarget?.releasePointerCapture?.(d.id); } catch {}
				setDragging(false);
				setSnapHint(null);
				if (!d.moved) {
					if (clickAction) clickAction();
					setLive(null);
					return;
				}
				dockOnceRef.current = false; /* 手动放置：不再自动贴边 */
				const p = live ?? { x: d.x, y: d.y };
				const snapped = snapPosition(p.x, p.y, d.w, d.h);
				setLive(null);
				/* 左右边缘释放 → 贴边停靠（半隐藏侧签）；离开边缘则解除停靠 */
				const dockEdge = snapHint === "left" || snapHint === "right" ? snapHint : null;
				instance.actions.setUi({
					pos: snapped,
					...(dockEdge
						? { collapsed: true, edge: dockEdge }
						: { edge: null })
				});
				/* 吸附动画：先挂 anim 属性再落位 */
				const el = ref.current;
				if (el) {
					el.setAttribute("data-anim", "true");
					window.setTimeout(() => el.removeAttribute("data-anim"), 220);
				}
			}, [live, instance, snapHint]);

			/* 折叠/展开过渡动画（“卡片收起 → 药丸弹出” / “药丸放大 → 卡片展开”） */
			const [anim, setAnim] = useState(null); /* "collapse" | "expand" | null */
			const collapseWithAnim = useCallback(() => {
				if (anim === "collapse") return;
				dockOnceRef.current = true;
				setAnim("collapse");
				window.setTimeout(() => {
					setAnim(null);
					instance.actions.setUi({ collapsed: true });
				}, 170);
			}, [anim, instance]);
			const expandWithAnim = useCallback((patch) => {
				dockOnceRef.current = false;
				instance.actions.setUi(Object.assign({ collapsed: false }, patch));
				setAnim("expand");
				window.setTimeout(() => setAnim(null), 200);
			}, [instance]);

			/* 从停靠态展开：解除停靠，卡片整体留在该侧可视范围 */
			const expandFromDock = useCallback(() => {
				const vw = window.innerWidth, vh = window.innerHeight;
				const y = Math.min(Math.max(ui.pos?.y ?? (vh - 220), SNAP_MARGIN), Math.max(SNAP_MARGIN, vh - 240));
				expandWithAnim({
					edge: null,
					pos: ui.edge === "right"
						? { x: Math.max(SNAP_MARGIN, vw - 320), y }
						: { x: 16, y }
				});
			}, [expandWithAnim, ui.pos, ui.edge]);

			const pos = live ?? ui.pos;
			const style = Object.assign(
				ui.liquidGlass ? {} : { "--qf-o": String(ui.opacity) },
				pos
					? { left: `${pos.x}px`, top: `${pos.y}px` }
					: { right: "16px", bottom: "16px" }
			);

			/* 贴边停靠：半隐藏侧签（悬停探出，单击展开，可拖离） */
			if (ui.collapsed && ui.edge && !dragging) {
				const first = cards.list[0];
				const dockStyle = Object.assign(
					ui.liquidGlass ? {} : { "--qf-o": String(ui.opacity) },
					{
						top: `${Math.min(Math.max(ui.pos?.y ?? 80, SNAP_MARGIN), Math.max(SNAP_MARGIN, window.innerHeight - 90))}px`
					},
					ui.edge === "right" ? { right: `${SNAP_MARGIN}px` } : { left: `${SNAP_MARGIN}px` }
				);
				return h("div", {
					ref, className: "qf-root", style: dockStyle,
					"data-edge": ui.edge,
					"data-glass": ui.liquidGlass ? "true" : undefined,
					"data-dragging": dragging ? "true" : undefined,
					onPointerDown, onPointerMove,
					onPointerUp: (e) => endDrag(e, expandFromDock),
					onPointerCancel: (e) => endDrag(e, null),
					role: "button", "aria-label": t("title"), tabIndex: 0,
					onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") expandFromDock(); },
					title: t("expand")
				},
					h("div", { className: "qf-edgeTab" },
						h("span", { className: "qf-edgeTabGrip" }, ui.edge === "left" ? "»" : "«"),
						h("span", { className: "qf-dot", "data-s": first?.data?.status ?? "unknown" }),
						h("span", { className: "qf-edgeTabVal" }, first?.data?.primary ?? "…")
					)
				);
			}

			if (ui.collapsed) {
				const first = cards.list[0];
				return h("div", {
					ref, className: "qf-root", style,
					"data-glass": ui.liquidGlass ? "true" : undefined,
					"data-dragging": dragging ? "true" : undefined,
					"data-snap": snapHint ?? undefined,
					onPointerEnter: () => setHovered(true),
					onPointerLeave: () => setHovered(false),
					onPointerDown, onPointerMove,
					onPointerUp: (e) => endDrag(e, () => expandWithAnim()),
					onPointerCancel: (e) => endDrag(e, null),
					role: "button", "aria-label": t("title"), tabIndex: 0,
					onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") expandWithAnim(); }
				},
					h("div", { className: "qf-collapsed", "data-anim-in": "true" },
						h("span", { className: "qf-grip" }, "⠿"),
						h("span", { className: "qf-dot", "data-s": first?.data?.status ?? "unknown" }),
						h("span", { className: "qf-mini" }, first?.data?.primary ?? "…"),
						h("span", { className: "qf-rowAgo" }, t("expand"))
					)
				);
			}

			return h("div", {
				ref, className: "qf-root", style,
				"data-glass": ui.liquidGlass ? "true" : undefined,
				"data-dragging": dragging ? "true" : undefined,
				"data-snap": snapHint ?? undefined
			},
				h("div", {
					className: "qf-card",
					"data-collapsing": anim === "collapse" ? "true" : undefined,
					"data-anim-in": anim === "expand" ? "true" : undefined
				},
					h("div", {
						className: "qf-head",
						onPointerDown, onPointerMove,
						onPointerUp: (e) => endDrag(e, collapseWithAnim),
						onPointerCancel: (e) => endDrag(e, null),
						title: t("dragHint")
					},
						h("span", { className: "qf-grip" }, "⠿⠿"),
						h("span", { className: "qf-title" }, t("title")),
						ui.autoFollow ? h("span", { className: "qf-follow", title: currentModel ? `${currentModel.provider} · ${currentModel.model}` : t("noFollow") },
							currentModel ? `${t("follow")} · ${currentModel.model}` : t("noFollow")) : null,
						h("button", {
							className: "qf-iconBtn", "data-busy": busy ? "true" : undefined,
							onClick: manualRefresh, title: t("refresh"), type: "button"
						}, h("span", { className: "qf-spin" }, "↻")),
						h("button", {
							className: "qf-iconBtn", onClick: collapseWithAnim,
							title: t("collapse"), type: "button"
						}, "—")
					),
					h("div", { className: "qf-body" },
						cards.list.length === 0
							? h("div", { className: "qf-note" }, t("empty"))
							: cards.list.map((c) => h(CardRowView, {
								key: c.id, card: c, match: c.id === cards.matchId, expanded: true, t, now
							}))
					),
					h("div", { className: "qf-foot" },
						h("button", {
							className: "qf-iconBtn", type: "button",
							"data-on": ui.liquidGlass ? "true" : undefined,
							onClick: () => instance.actions.setUi({ liquidGlass: !ui.liquidGlass }),
							title: t("settings.liquidGlass"), "aria-label": t("settings.liquidGlass")
						}, "◇"),
						ui.liquidGlass
							? h("span", { className: "qf-glassLabel" }, "液态玻璃")
							: h(Fr, null,
								h("span", null, t("settings.opacity")),
								h("input", {
									type: "range", min: 0.4, max: 1, step: 0.02,
									value: ui.opacity,
									onInput: (e) => instance.actions.setUi({ opacity: parseFloat(e.currentTarget.value) }),
									"aria-label": t("settings.opacity")
								}),
								h("span", null, `${Math.round(ui.opacity * 100)}%`)
							)
					)
				)
			);
		}

		/* ================================================================
		 * Settings section
		 * ================================================================ */
		const REFRESH_OPTIONS = [
			{ value: 0, label: null },
			{ value: 30 * 1000, label: "30s" },
			{ value: 60 * 1000, label: "1m" },
			{ value: 5 * 60 * 1000, label: "5m" },
			{ value: 15 * 60 * 1000, label: "15m" },
			{ value: 30 * 60 * 1000, label: "30m" },
			{ value: 60 * 60 * 1000, label: "1h" }
		];
		const FALLBACK_DSH_PROVIDERS = ["deepseek", "zai-coding-cn", "gml", "dashscope", "minimax", "minimax-cn"];

		function CardEditor({ card, instance, engine, dshProviders, t, index }) {
			const [showKey, setShowKey] = useState(false);
			const [testing, setTesting] = useState(false);
			const [testResult, setTestResult] = useState(null);
			const patch = (p) => instance.actions.patchCard(card.id, p);
			const toggleMatch = (pid) => {
				const cur = card.matchProviders || [];
				patch({ matchProviders: cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid] });
			};
			const runTest = async () => {
				setTesting(true);
				setTestResult(null);
				try {
					await engine.refreshCard(card, true);
					const after = instance.getSnapshot().cards.find((c) => c.id === card.id);
					const d = after?.data;
					setTestResult(d?.ok ? `✓ ${d.primary}${d.meters?.length ? ` · ${d.meters.length} 窗口` : ""}` : `✗ ${d?.error || "失败"}`);
				} finally {
					setTesting(false);
				}
			};
			return h("div", { className: "qfs-card" },
				h("div", { className: "qfs-row" },
					h("label", { className: "qfs-check" },
						h("input", { type: "checkbox", checked: !!card.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }),
						`#${index + 1}`
					),
					h("input", {
						className: "qfs-input qfs-name", value: card.name,
						placeholder: t("settings.cardName"),
						onInput: (e) => patch({ name: e.target.value })
					}),
					h("select", {
						className: "qfs-select", value: card.providerId,
						onChange: (e) => patch({ providerId: e.target.value, data: null })
					}, PROVIDER_ORDER.map((pid) => h("option", { key: pid, value: pid }, t(`provider.${pid}`)))),
					h("button", { className: "qfs-btn", type: "button", onClick: runTest, disabled: testing }, testing ? t("fetching") : t("settings.cardQuery")),
					h("button", {
						className: "qfs-btn", type: "button", "data-danger": "true",
						onClick: () => instance.actions.removeCard(card.id)
					}, t("settings.cardDelete"))
				),
				h("div", { className: "qfs-row" },
					h("label", { style: { flex: "none" } }, t("settings.cardKey")),
					h("input", {
						className: "qfs-input", type: showKey ? "text" : "password",
						value: card.apiKey || "", spellCheck: false, autoComplete: "off",
						placeholder: "sk-…",
						onInput: (e) => patch({ apiKey: e.target.value.trim() })
					}),
					h("button", { className: "qfs-btn", type: "button", onClick: () => setShowKey(!showKey) }, showKey ? t("settings.cardKeyHide") : t("settings.cardKeyShow"))
				),
				h("div", null,
					h("div", { className: "qfs-note", style: { marginBottom: 4 } }, t("settings.cardMatch")),
					h("div", { className: "qfs-match" },
						dshProviders.map((pid) => h("label", { className: "qfs-check", key: pid },
							h("input", {
								type: "checkbox",
								checked: (card.matchProviders || []).includes(pid),
								onChange: () => toggleMatch(pid)
							}),
							pid
						))
					)
				),
				h("div", { className: "qfs-testResult" }, testResult ?? (card.data?.error ? `上次：✗ ${card.data.error}` : ""))
			);
		}

		function QuotaFloatSettings(props) {
			const { instance, engine, modelCatalog, t, close } = props;
			ensureStyles();
			const state = useSyncExternalStore(
				useCallback((cb) => instance.subscribe(cb), [instance]),
				useCallback(() => instance.getSnapshot(), [instance])
			);
			const ui = state.ui;
			const [catalog, setCatalog] = useState(null);
			useEffect(() => {
				let alive = true;
				modelCatalog().then((r) => {
					if (alive && r && r.ok && r.value) setCatalog(r.value);
				}).catch(() => {});
				return () => { alive = false; };
			}, [modelCatalog]);
			const dshProviders = useMemo(() => {
				if (catalog?.groups?.length) return catalog.groups.map((g) => g.id);
				return FALLBACK_DSH_PROVIDERS;
			}, [catalog]);
			const addCard = () => {
				instance.actions.upsertCard({
					id: uid(),
					providerId: "deepseek",
					name: "",
					apiKey: "",
					matchProviders: [],
					enabled: true,
					data: null
				});
			};
			return h("div", { className: "qfs-root" },
				h("p", { className: "qfs-desc" }, t("settings.desc")),
				h("section", null,
					h("h3", { className: "qfs-h" }, t("settings.cards")),
					state.cards.map((c, i) => h(CardEditor, {
						key: c.id, card: c, index: i, instance, engine, dshProviders, t
					})),
					h("div", { className: "qfs-row", style: { marginTop: 8 } },
						h("button", { className: "qfs-btn", type: "button", onClick: addCard }, "＋ " + t("settings.addCard"))
					)
				),
				h("section", null,
					h("h3", { className: "qfs-h" }, t("settings.display")),
					h("div", { className: "qfs-row" },
						h("label", { className: "qfs-check" },
							h("input", {
								type: "checkbox", checked: ui.autoFollow,
								onChange: (e) => instance.actions.setUi({ autoFollow: e.target.checked })
							}),
							t("settings.autoFollow")
						)
					),
					h("div", { className: "qfs-row" },
						h("label", { className: "qfs-check" },
							h("input", {
								type: "checkbox", checked: ui.showAll,
								onChange: (e) => instance.actions.setUi({ showAll: e.target.checked })
							}),
							t("settings.showAll")
						)
					),
					h("div", { className: "qfs-row" },
						h("label", { className: "qfs-check" },
							h("input", {
								type: "checkbox", checked: !!ui.liquidGlass,
								onChange: (e) => instance.actions.setUi({ liquidGlass: e.target.checked })
							}),
							t("settings.liquidGlass")
						)
					),
					h("div", { className: "qfs-row" },
						h("label", null, t("settings.refresh")),
						h("select", {
							className: "qfs-select", value: ui.refreshMs,
							onChange: (e) => instance.actions.setUi({ refreshMs: parseInt(e.target.value, 10) })
						}, REFRESH_OPTIONS.map((o) => h("option", { key: o.value, value: o.value }, o.label ?? t("settings.refresh.off")))),
						h("label", null, t("settings.opacity")),
						h("div", { className: "qfs-sliderRow" },
							h("input", {
								type: "range", min: 0.4, max: 1, step: 0.02, value: ui.opacity,
								onInput: (e) => instance.actions.setUi({ opacity: parseFloat(e.currentTarget.value) })
							}),
							h("span", { className: "qfs-note" }, `${Math.round(ui.opacity * 100)}%`)
						),
						h("button", {
							className: "qfs-btn", type: "button",
							onClick: () => instance.actions.setUi({ pos: null, collapsed: false, edge: null })
						}, t("settings.resetPos"))
					)
				),
				close ? h("div", { className: "qfs-row" },
					h("button", { className: "qfs-btn", type: "button", onClick: close }, t("settings.done"))
				) : null
			);
		}

		/* ================================================================
		 * Client plugin body
		 * ================================================================ */
		/** Required client services: slot registry, locale, session adapter, remote session (model catalog). */
		const inject = ["slots", "locale", "uiSession", "remote", "remote.session"];

		function withBoundary(Component) {
			return function QuotaFloatEntry(props) {
				return h(SafeBoundary, null, h(Component, props));
			};
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "quota-float: dictionaries");
			const t = ctx.locale.bind(NS);
			const handle = createStoreHandle();
			const instance = handle.create();
			const engine = createEngine(instance);
			ctx.slots.inject("shell.overlay", () => {
				const dispose = ctx.slots.register({
					name: "shell.overlay",
					id: "quota-float",
					order: 15,
					locale: NS,
					inject: () => ({ instance, engine, current: ctx.uiSession.current })
				}, withBoundary(QuotaFloatWidget));
				return () => dispose();
			});
			ctx.slots.inject("settings.section", () => {
				const dispose = ctx.slots.register({
					name: "settings.section",
					id: "quota-float",
					order: 60,
					label: () => t("nav"),
					locale: NS,
					inject: () => ({
						instance,
						engine,
						modelCatalog: () => ctx.remote.session.modelCatalog()
					})
				}, withBoundary(QuotaFloatSettings));
				return () => dispose();
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceURL=dsh-quota-float/client.js
