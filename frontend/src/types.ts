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
  thumbnailUrl?: string;
  previewUrl?: string;
  previewLargeUrl?: string;
}
export interface ImageAsset extends Attachment {
  userId: string;
  createdAt: string;
  batchId: string;
  outputIndex: number;
  prompt: string;
  options: GenerationOptions;
  folderIds: string[];
  trashedAt?: string;
}
export interface ImagePage {
  images: ImageAsset[];
  total: number;
  nextCursor?: string;
}
export interface ImageListOptions {
  view?: "active" | "trash";
  folderId?: string;
  cursor?: string;
  signal?: AbortSignal;
}
export interface PreviewCollectionOptions {
  view?: "active" | "trash";
  folderId?: string;
  total?: number;
  nextCursor?: string;
}
export interface Folder {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}
export interface GenerationOutput {
  outputIndex: number;
  status: "queued" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  imageState?: "available" | "trashed" | "deleted";
  imageStates?: Record<string, "available" | "trashed" | "deleted">;
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
  outputs?: GenerationOutput[];
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
  priceVersions?: Partial<Record<ModelId, number>>;
  preferences: Preferences;
  imageSummary?: { total: number; folderCounts: Record<string, number>; trashTotal?: number };
}
export interface NotifyOptions {
  durationMs?: number;
  dismissible?: boolean;
}
export type Notify = (
  message: string,
  action?: { label: string; run: () => void },
  options?: NotifyOptions,
) => void;
export type PreviewImage = (
  image: ImageAsset,
  collection: ImageAsset[],
  options?: PreviewCollectionOptions,
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
    onAccepted?: (generation: Generation) => void,
  ) => Promise<Generation>;
  createFolder: (name: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  addToFolders: (imageIds: string[], folderIds: string[]) => Promise<void>;
  removeFromFolder: (imageIds: string[], folderId: string) => Promise<void>;
  trashImages: (imageIds: string[]) => Promise<void>;
  restoreImages: (imageIds: string[]) => Promise<void>;
  purgeImages: (imageIds: string[]) => Promise<void>;
  setPreferences: (patch: Partial<Preferences>) => Promise<void>;
  createUser: (input: CreateUserInput) => Promise<StudioUser>;
  updateUser: (
    id: string,
    patch: Pick<StudioUser, "role" | "status">,
  ) => Promise<void>;
  adjustCredits: (id: string, amount: number) => Promise<void>;
  savePrice: (id: ModelId, amount: number, version?: number) => Promise<void>;
  refreshData?: () => Promise<StudioData>;
  listImages?: (options?: ImageListOptions) => Promise<ImagePage>;
  loadHistory?: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  signOut: () => void;
  signIn: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
}
