/**
 * Fetching a vendor's link on the plugin's behalf.
 *
 * A plugin whose vendor answers with a URL passes the address through rather than downloading it.
 * The host is the side that knows whether it wants a copy: this one does, because it stores assets
 * locally; a hosted deployment sitting behind the same object storage might record the address and
 * never transfer anything. Making the plugin download it would pay for the transfer twice and push
 * the bytes back through a stdio pipe on the way.
 *
 * hrhrng.hub is the first executor here whose vendor replies with a link. Everything upstream
 * already worked -- the credential imports itself from the local app, the task submits, the poll
 * completes -- and the result was being dropped at this last step.
 */

export interface FetchIntoSlotOptions {
  fetchImpl?: typeof fetch;
  /** What the plugin said it was, which beats what the server says. */
  mediaType?: string;
}

export interface FetchedAsset {
  bytes: Uint8Array;
  mediaType?: string;
}

export async function fetchIntoSlot(
  url: string,
  options: FetchIntoSlotOptions = {},
): Promise<FetchedAsset> {
  if (!url.startsWith("https://")) {
    throw new Error(`Refusing to fetch ${url}: the host will transfer these bytes, so it must be https.`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    // A 403 body is bytes too. Storing it produces an asset that opens as text and a node that
    // looks finished.
    throw new Error(
      `The vendor's link answered ${response.status}; the generation completed but its result could not be collected.`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("The vendor's link returned no bytes, so there is nothing to store.");
  }

  // The plugin's declared type wins. Vendors serve generated media as application/octet-stream
  // often enough that trusting the header stores a video the player then refuses to open.
  const mediaType = options.mediaType ?? response.headers.get("content-type") ?? undefined;
  return { bytes, ...(mediaType ? { mediaType } : {}) };
}
