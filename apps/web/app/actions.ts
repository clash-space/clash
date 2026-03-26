'use server';

import { projects } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';

import * as schema from '@/lib/db/schema';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { headers } from 'next/headers';
import { DEV_USER_ID, getUserIdFromHeaders, getUserIdOrDevFromHeaders } from '@/lib/auth/session';

// Helper to get DB (D1 binding via Cloudflare context)
// Note: initOpenNextCloudflareForDev() in next.config.ts enables bindings during next dev
// Proxy must be set via HTTP_PROXY env var in startup command for network access
const getDb = async () => {
    try {
        const { env } = await getCloudflareContext({ async: true });
        const bindings = env as unknown as { DB?: Parameters<typeof drizzleD1>[0] };
        
        console.log('[getDb] Cloudflare env keys:', Object.keys(env || {}));
        
        if (bindings.DB) {
            console.log('[getDb] D1 binding found');
            return drizzleD1(bindings.DB, { schema });
        } else {
            console.warn('[getDb] D1 binding (DB) is missing from context');
        }
    } catch (e) {
        console.error('[getDb] Failed to get Cloudflare context:', e);
    }

    throw new Error('No database connection available');
}


async function getUserId() {
    const h = new Headers(await headers())
    const userId = await getUserIdFromHeaders(h)
    if (userId) return userId
    if (process.env.NODE_ENV === 'development') return DEV_USER_ID
    return null
}

async function requireUserId() {
    const h = new Headers(await headers())
    return getUserIdOrDevFromHeaders(h)
}

async function ensureDevUserExists(db: Awaited<ReturnType<typeof getDb>>) {
    if (process.env.NODE_ENV !== 'development') return
    await db.run(
        sql`INSERT OR IGNORE INTO user (id, name, email, emailVerified) VALUES (${DEV_USER_ID}, ${'Dev User'}, ${'dev@local'}, ${1})`
    )
}

// Project Actions

export type CommandType = 'ADD_NODE' | 'ADD_EDGE' | 'UPDATE_NODE' | 'DELETE_NODE';

export interface Command {
    type: CommandType;
    payload: any;
}

export async function createProject(prompt: string) {
    const db = await getDb();
    const userId = await requireUserId();
    if (userId === DEV_USER_ID) {
        await ensureDevUserExists(db)
    }
    const [project] = await db.insert(projects).values({
        ownerId: userId,
        name: prompt.length > 20 ? prompt.substring(0, 20) + '...' : prompt,
        description: prompt,
    }).returning();

    // Simple approach: Pass prompt via URL parameter
    // ChatbotCopilot will send it as a normal message
    redirect(`/projects/${project.id}?prompt=${encodeURIComponent(prompt)}`);
}

export async function getProjects(limit = 10) {
    try {
        const db = await getDb();
        const userId = await getUserId();
        if (!userId) return [];
        if (userId === DEV_USER_ID) {
            await ensureDevUserExists(db)
        }

        const projectsData = await db.query.projects.findMany({
            where: eq(projects.ownerId, userId),
            orderBy: [desc(projects.createdAt)],
            limit: limit,
        });

        console.log('[getProjects] Raw projects found:', projectsData.length);

        const apiCfUrl = process.env.API_CF_URL || 'http://localhost:8789';
        const httpLoroUrl = apiCfUrl;

        // Extract assets from Loro nodes for display
        return await Promise.all(projectsData.map(async (project) => {
            let nodes: any[] = [];

            // 1. Try to fetch from Loro Sync Server
            try {
                // Determine protocol/url
                const response = await fetch(`${httpLoroUrl}/sync/${project.id}/nodes`, {
                    next: { revalidate: 0 } // Don't cache this fetch
                });

                if (response.ok) {
                    nodes = await response.json();
                }
            } catch (_e) {
                // console.error(`[getProjects] Error fetching nodes from Loro for project ${project.id}:`, e);
            }

            // Extract assets from nodes for display
            const assets = nodes
                .filter((node: any) =>
                    (node.type === 'image' || node.type === 'video') &&
                    node.data?.src
                )
                .map((node: any) => {
                    let src = node.data.src;

                    // Normalize URL paths
                    if (src) {
                        if (src.startsWith('http://') || src.startsWith('https://')) {
                            try {
                                const srcUrl = new URL(src);
                                if (srcUrl.pathname.startsWith('/assets/')) {
                                    src = srcUrl.pathname.replace('/assets/', '');
                                }
                            } catch (_e) {
                                // Invalid URL, leave as is
                            }
                        }

                        if (src.startsWith('projects/') || src.startsWith('/projects/')) {
                            const cleanKey = src.startsWith('/') ? src.slice(1) : src;
                            src = `/api/assets/view/${cleanKey}`;
                        }
                    }

                    if (process.env.NODE_ENV === 'development') {
                       // console.log(`[getProjects] Asset processed: ${node.id}, original: ${node.data.src}, final: ${src}`);
                    }

                    // For videos, use coverUrl if available
                    let thumbnailUrl: string | null = null;
                    if (node.type === 'video' && node.data.coverUrl) {
                        thumbnailUrl = node.data.coverUrl;
                        if (thumbnailUrl && (thumbnailUrl.startsWith('projects/') || thumbnailUrl.startsWith('/projects/'))) {
                            const cleanKey = thumbnailUrl.startsWith('/') ? thumbnailUrl.slice(1) : thumbnailUrl;
                            thumbnailUrl = `/api/assets/view/${cleanKey}`;
                        }
                    } else if (node.type === 'video') {
                        return null;
                    }

                    return {
                        id: node.id,
                        url: thumbnailUrl || src,
                        type: node.type as 'image' | 'video',
                        storageKey: node.data.storageKey || '',
                        createdAt: (() => {
                            // 1. Try node.data.createdAt (explicit metadata)
                            if (node.data?.createdAt) {
                                return new Date(node.data.createdAt);
                            }

                            // 2. Try node.createdAt (if stored on node root)
                            if (node.createdAt) {
                                return new Date(node.createdAt);
                            }

                            // 3. Fallback to project updated time (or created time)
                            return project.updatedAt || project.createdAt;
                        })()
                    };
                })
                .filter((asset): asset is NonNullable<typeof asset> => asset !== null);

            return {
                ...project,
                assets
            };
        }));
    } catch (error) {
        console.error('[getProjects] Failed to fetch projects:', error);
        return [];
    }
}

export async function getProject(id: string) {
    try {
        const db = await getDb();
        const userId = await getUserId();
        if (!userId) return null;
        if (userId === DEV_USER_ID) {
            await ensureDevUserExists(db)
        }
        return await db.query.projects.findFirst({
            where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
        });
    } catch (error) {
        console.error(`[getProject] Failed to fetch project ${id}:`, error);
        return null;
    }
}

/**
 * @deprecated No-op: Loro is the single source of truth for nodes/edges.
 * This function is kept for backward compatibility but does nothing.
 * Canvas state is now managed entirely by Loro sync.
 */
export async function saveProjectState(_id: string, _nodes: any, _edges: any) {
    // No-op: Loro handles canvas state sync
    console.log('[saveProjectState] No-op: Loro is the single source of truth');
}

export async function updateProjectName(id: string, name: string) {
    const db = await getDb();
    const userId = await requireUserId();
    if (userId === DEV_USER_ID) {
        await ensureDevUserExists(db)
    }
    await db.update(projects)
        .set({ name })
        .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));
    revalidatePath(`/projects/${id}`);
}

export async function deleteProject(id: string) {
    const db = await getDb();
    const userId = await requireUserId();
    if (userId === DEV_USER_ID) {
        await ensureDevUserExists(db)
    }
    await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerId, userId)));
    revalidatePath('/projects');
}

