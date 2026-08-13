import { ResolvedAssetSchema } from "@clash/shared-types";
import GlobalAssetsClient from "@clash/web-ui/components/GlobalAssetsClient";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";
import { redirect, useLoaderData } from "react-router";

export async function loader() {
  const response = await fetch(
    runtimeApiUrl("/api/v1/libraries/personal/assets"),
    { credentials: "include" },
  );
  if (response.status === 401) throw redirect("/login");
  if (!response.ok) {
    throw new Response("Failed to load Global Assets", {
      status: response.status,
    });
  }
  const body = (await response.json()) as { assets?: unknown };
  return { assets: ResolvedAssetSchema.array().parse(body.assets) };
}

export default function AssetsRoute() {
  const { assets } = useLoaderData<typeof loader>();
  return <GlobalAssetsClient initialAssets={assets} />;
}
