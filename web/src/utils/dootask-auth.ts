export async function getDooTaskUserToken(): Promise<string | null> {
  try {
    const tools = await import("@dootask/tools");

    // Throws UnsupportedError outside DooTask micro-app environment.
    await tools.appReady();

    const isMicro = await tools.isMicroApp();
    if (!isMicro) return null;

    const userId = await tools.getUserId().catch(() => 0);
    if (!userId) return null;

    const token = await tools.getUserToken().catch(() => "");
    const trimmed = token?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}
