/**
 * Quota float plugin, node half.
 *
 * 浏览器端直连部分官方端点会被 CORS 预检拒绝（实测：
 *  - coding.dashscope.aliyuncs.com 对 OPTIONS 直接 401；
 *  - ark.cn-beijing.volces.com 的 CORS 不允许 authorization 头）。
 * 本宿主半在 web 载体上注册一个固定 allowlist 的同源代理路由：
 *   GET /quota-float-proxy?providerId=<id>&apiKey=<key>
 * （desktop 前置层对非 /api 路径仅转发 GET——POST 会被裸 405 拒绝；
 *   /api 前缀被 API 网关独占，自定义 exact 路由不生效。）
 * 只转发到本文件内置的官方余额/配额端点（无任意 URL 转发面），
 * 密钥由浏览器端逐次携带、宿主不落盘；服务本身仅监听 loopback。
 */

export const inject = ["webServer"];

/** 允许代理的端点 allowlist（与浏览器端 PROVIDERS 注册表保持一致）。 */
const ALLOWED = {
	deepseek: {
		method: "GET",
		url: "https://api.deepseek.com/user/balance"
	},
	kimi: {
		method: "GET",
		url: "https://api.moonshot.cn/v1/users/me/balance"
	},
	glm: {
		method: "GET",
		url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
	},
	minimax: {
		method: "GET",
		url: "https://api.minimaxi.com/v1/token_plan/remains"
	},
	qwen: {
		method: "POST",
		url: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
		body: { model: "qwen3.7-plus", messages: [{ role: "user", content: "ping" }], max_tokens: 5 }
	},
	ark: {
		method: "POST",
		url: "https://ark.cn-beijing.volces.com/api/coding/v3/responses",
		body: { model: "doubao-seed-2.0-code", input: "ping", max_output_tokens: 16 }
	}
};

const PROXY_PATH = "/quota-float-proxy";
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	res.end(body);
}

/** Host plugin body：注册同源代理路由（插件卸载时自动撤销）。 */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: PROXY_PATH,
		handler: async (req, res) => {
			try {
				if (req.method !== "GET" && req.method !== "HEAD") {
					sendJson(res, 405, { error: "method not allowed" });
					return;
				}
				const url = new URL(req.url ?? "/", "http://localhost");
				const providerId = url.searchParams.get("providerId") ?? "";
				const apiKey = url.searchParams.get("apiKey") ?? "";
				const spec = ALLOWED[providerId];
				if (!spec || apiKey === "") {
					sendJson(res, 400, { error: "unknown provider or missing apiKey" });
					return;
				}
				const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
				const init = { method: spec.method, headers, signal: AbortSignal.timeout(20000) };
				if (spec.body && spec.method === "POST") init.body = JSON.stringify(spec.body);
				const upstream = await fetch(spec.url, init);
				const body = (await upstream.text()).slice(0, MAX_BODY_BYTES);
				sendJson(res, 200, { status: upstream.status, body });
			} catch (error) {
				sendJson(res, 502, { error: String(error?.message || error || "proxy failure").slice(0, 200) });
			}
		}
	}), "quota-float: provider proxy route");
}
