/**
 * Global desktop-shell elevation order. Keep task surfaces below transient
 * navigation, while leaving higher overlay primitives (dialogs, popovers,
 * command menus) to their established 70/80/90 layers.
 */
export const DESKTOP_SHELL_LAYERS = {
  dashboardTask: 20,
  sidebarRecovery: 30,
  sidebarPreview: 50,
} as const;
