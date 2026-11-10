import { useStudio } from "../../state/StudioContext";
import { Icon } from "../../components/Icon";
import "./settings.css";
import type { Props } from "./types";
import { Account } from "./Account";
import { Appearance } from "./Appearance";
import { Credits } from "./Credits";
import { Users } from "./Users";
import { Requests } from "./Requests";
import { Prices } from "./Prices";
export default function SettingsPage(props: Props) {
  const { currentUser } = useStudio();
  const { section } = props;
  if (
    ["users", "requests", "prices"].includes(section) &&
    currentUser.role !== "admin"
  )
    return (
      <div className="settings-scroll">
        <div className="settings-content settings-restricted">
          <Icon name="shield" />
          <h1>没有访问权限</h1>
          <button className="btn" onClick={() => props.onNavigate("account")}>
            返回账户设置
          </button>
        </div>
      </div>
    );
  return (
    <div className="settings-scroll">
      <div className="settings-content">
        {section === "account" && <Account />}
        {section === "appearance" && <Appearance notify={props.notify} />}
        {section === "credits" && <Credits notify={props.notify} />}
        {section === "users" && (
          <Users notify={props.notify} onNavigate={props.onNavigate} />
        )}
        {section === "requests" && (
          <Requests
            requestUserFilter={props.requestUserFilter}
            onPreview={props.onPreview}
          />
        )}
        {section === "prices" && (
          <Prices notify={props.notify} onDirtyChange={props.onDirtyChange} />
        )}
      </div>
    </div>
  );
}
