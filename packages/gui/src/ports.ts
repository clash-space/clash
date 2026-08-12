export interface GuiExternalNavigationPort {
  open(url: string): void | Promise<void>;
}

export interface GuiKeyValueStoragePort {
  read(key: string): string | null | Promise<string | null>;
  write(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

export interface GuiPlatformPorts {
  externalNavigation: GuiExternalNavigationPort;
  storage: GuiKeyValueStoragePort;
}
