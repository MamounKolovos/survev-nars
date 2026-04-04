import { Config } from "../config";

export async function fetchApiServer<Body extends object>(route: string, body: Body) {
    const url = `${Config.gameServer.apiServerUrl}/${route}`;

    const res = await fetch(url, {
        method: "post",
        headers: {
            "content-type": "application/json",
            "survev-api-key": Config.secrets.SURVEV_API_KEY,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
    });

    return res.json();
}
