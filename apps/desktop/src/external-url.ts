export async function openExternalHttpUrl(
  value: string,
  open: (url: string) => Promise<unknown>,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Only HTTP and HTTPS URLs can be opened");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS URLs can be opened");
  }
  await open(url.toString());
}
