export interface FeishuProfile {
  open_id: string;
  name?: string;
  en_name?: string;
  avatar_url?: string;
}

export function feishuConfigured() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_REDIRECT_URI);
}

export function feishuAuthorizeUrl(state: string) {
  const url = new URL("https://open.feishu.cn/open-apis/authen/v1/index");
  url.searchParams.set("app_id", process.env.FEISHU_APP_ID!);
  url.searchParams.set("redirect_uri", process.env.FEISHU_REDIRECT_URI!);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function getFeishuProfile(code: string): Promise<FeishuProfile> {
  const appTokenResponse = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }), cache: "no-store",
  });
  const appTokenJson = await appTokenResponse.json();
  const appToken = appTokenJson.app_access_token as string | undefined;
  if (!appTokenResponse.ok || !appToken) throw new Error("飞书应用凭证验证失败");
  const tokenResponse = await fetch("https://open.feishu.cn/open-apis/authen/v1/access_token", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${appToken}` },
    body: JSON.stringify({ grant_type: "authorization_code", code }), cache: "no-store",
  });
  const tokenJson = await tokenResponse.json();
  const userToken = tokenJson.data?.access_token as string | undefined;
  if (!tokenResponse.ok || !userToken) throw new Error("飞书登录凭证交换失败");
  const profileResponse = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
    headers: { authorization: `Bearer ${userToken}` }, cache: "no-store",
  });
  const profileJson = await profileResponse.json();
  const profile = profileJson.data as FeishuProfile | undefined;
  if (!profileResponse.ok || !profile?.open_id) throw new Error("无法读取飞书用户身份");
  return profile;
}
