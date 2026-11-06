export type ModelId =
  | "gpt-image-2"
  | "gpt-image-1.5"
  | "gpt-image-2.5-sunburst"
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image";
export type Theme = "light" | "dark" | "system";
export type SettingsSection =
  | "account"
  | "appearance"
  | "credits"
  | "users"
  | "requests"
  | "prices";
export interface ModelConfig {
  id: ModelId;
  name: string;
  qualities: string[];
  resolutions: string[];
  ratios: string[];
}
export interface GenerationOptions {
  modelId: ModelId;
  quality?: string;
  resolution?: string;
  ratio: string;
  count: number;
}
export interface Attachment {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}
export interface ImageAsset extends Attachment {
  userId: string;
  createdAt: string;
  batchId: string;
  outputIndex: number;
  prompt: string;
  options: GenerationOptions;
  folderIds: string[];
}
export interface Folder {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}
export interface Generation {
  id: string;
  userId: string;
  username: string;
  prompt: string;
  attachments: Attachment[];
  options: GenerationOptions;
  status: "processing" | "completed" | "failed";
  imageIds: string[];
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  cost: number;
  error?: string;
}
export interface StudioUser {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "enabled" | "disabled";
  balance: number;
  createdAt: string;
}
export interface Preferences {
  theme: Theme;
  enterToSend: boolean;
}
export interface StudioData {
  version: 1;
  assets: ImageAsset[];
  folders: Folder[];
  generations: Generation[];
  users: StudioUser[];
  currentUserId: string;
  prices: Record<ModelId, number>;
  priceUpdatedAt: Partial<Record<ModelId, string>>;
  preferences: Preferences;
}
export type Notify = (
  message: string,
  action?: { label: string; run: () => void },
) => void;
export type PreviewImage = (
  image: ImageAsset,
  collection: ImageAsset[],
) => void;
export interface CreateUserInput {
  username: string;
  role: StudioUser["role"];
  status: StudioUser["status"];
  password: string;
}
export interface StudioActions {
  generate: (
    prompt: string,
    attachments: Attachment[],
    options: GenerationOptions,
  ) => Promise<Generation>;
  createFolder: (name: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  addToFolders: (imageIds: string[], folderIds: string[]) => Promise<void>;
  removeFromFolder: (imageIds: string[], folderId: string) => Promise<void>;
  setPreferences: (patch: Partial<Preferences>) => Promise<void>;
  createUser: (input: CreateUserInput) => Promise<StudioUser>;
  updateUser: (
    id: string,
    patch: Pick<StudioUser, "role" | "status">,
  ) => Promise<void>;
  adjustCredits: (id: string, amount: number) => Promise<void>;
  savePrice: (id: ModelId, amount: number) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  signOut: () => void;
  signIn: (username: string, password: string) => Promise<void>;
}
