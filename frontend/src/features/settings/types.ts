import type { Notify, PreviewImage, SettingsSection } from "../../types";

export interface Props {
  section: SettingsSection;
  onNavigate: (section: SettingsSection, filterUser?: string) => void;
  requestUserFilter?: string;
  notify: Notify;
  onPreview: PreviewImage;
  onDirtyChange?: (dirty: boolean) => void;
}
