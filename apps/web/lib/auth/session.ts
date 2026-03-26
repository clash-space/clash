import { initBetterAuth } from "@/better-auth"

export const DEV_USER_ID = "dev-user"

export async function getUserIdFromHeaders(headers: Headers): Promise<string | null> {
    // Dev mode: skip BetterAuth entirely, auto-login as dev-user
    if (process.env.NODE_ENV === "development") {
        return DEV_USER_ID
    }
    const auth = await initBetterAuth()
    const session = await auth.api.getSession({ headers })
    return session?.user?.id ?? null
}

export async function getUserIdOrDevFromHeaders(headers: Headers): Promise<string> {
    const userId = await getUserIdFromHeaders(headers)
    if (userId) return userId
    if (process.env.NODE_ENV === "development") return DEV_USER_ID
    throw new Error("Unauthorized")
}

export async function requireUserIdFromHeaders(headers: Headers): Promise<string> {
    const userId = await getUserIdFromHeaders(headers)
    if (!userId) {
        throw new Error("Unauthorized")
    }
    return userId
}
