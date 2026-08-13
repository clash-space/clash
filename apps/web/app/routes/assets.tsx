import GlobalAssetsClient from "@clash/web-ui/components/GlobalAssetsClient";
import { listPersonalGlobalAssets } from "@clash/web-ui/lib/hooks/useAsset";
import { redirect, useLoaderData } from "react-router";

export async function loader() {
  try {
    return { assets: await listPersonalGlobalAssets() };
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : undefined;
    if (status === 401) throw redirect("/login");
    if (status === undefined) throw error;
    throw new Response("Failed to load Global Assets", {
      status,
    });
  }
}

export default function AssetsRoute() {
  const { assets } = useLoaderData<typeof loader>();
  return <GlobalAssetsClient initialAssets={assets} />;
}
