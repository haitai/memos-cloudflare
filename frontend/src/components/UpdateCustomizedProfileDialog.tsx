import { Button, Input, Textarea } from "@usememos/mui";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { workspaceSettingNamePrefix } from "@/store/common";
import { workspaceStore } from "@/store/v2";
import { WorkspaceSettingKey } from "@/store/v2/workspace";
import { WorkspaceCustomProfile } from "@/types/proto/api/v1/workspace_setting_service";
import { useTranslate } from "@/utils/i18n";
import AppearanceSelect from "./AppearanceSelect";
import { generateDialog } from "./Dialog";
import LocaleSelect from "./LocaleSelect";

type Props = DialogProps;

const UpdateCustomizedProfileDialog = ({ destroy }: Props) => {
  const t = useTranslate();
  const workspaceGeneralSetting = workspaceStore.state.generalSetting;
  const [customProfile, setCustomProfile] = useState<WorkspaceCustomProfile>(
    WorkspaceCustomProfile.fromPartial(workspaceGeneralSetting.customProfile || {}),
  );

  const handleCloseButtonClick = () => {
    destroy();
  };

  const setPartialState = (partialState: Partial<WorkspaceCustomProfile>) => {
    setCustomProfile((state) => {
      return {
        ...state,
        ...partialState,
      };
    });
  };

  const handleNameChanged = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPartialState({
      title: e.target.value as string,
    });
  };

  const handleLogoUrlChanged = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPartialState({
      logoUrl: e.target.value as string,
    });
  };

  const handleDescriptionChanged = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPartialState({
      description: e.target.value as string,
    });
  };

  const handleLocaleSelectChange = (locale: Locale) => {
    setPartialState({
      locale: locale,
    });
  };

  const handleAppearanceSelectChange = (appearance: Appearance) => {
    setPartialState({
      appearance: appearance,
    });
  };

  const handleRestoreButtonClick = () => {
    setPartialState({
      title: "Memos",
      logoUrl: "/logo.webp",
      description: "",
      locale: "en",
      appearance: "system",
    });
  };

  const handleSaveButtonClick = async () => {
    if (customProfile.title === "") {
      toast.error("Title cannot be empty.");
      return;
    }

    try {
      await workspaceStore.upsertWorkspaceSetting({
        name: `${workspaceSettingNamePrefix}${WorkspaceSettingKey.GENERAL}`,
        generalSetting: {
          ...workspaceGeneralSetting,
          customProfile: customProfile,
        },
      });
    } catch (error) {
      console.error(error);
      return;
    }
    toast.success(t("message.update-succeed"));
    destroy();
  };

  return (
    <div className="max-w-full shadow flex flex-col justify-start items-start bg-white dark:bg-zinc-800 dark:text-gray-300 p-4 rounded-lg">
      <div className="flex flex-row justify-between items-center mb-4 gap-2 w-full">
        <p className="title-text">{t("setting.system-section.customize-server.title")}</p>
        <Button variant="plain" className="text-gray-700 dark:text-gray-300" onClick={handleCloseButtonClick}>
          <XIcon className="w-5 h-auto" />
        </Button>
      </div>
      <div className="flex flex-col justify-start items-start min-w-[16rem]">
        <p className="text-sm mb-1">{t("setting.system-section.server-name")}</p>
        <Input className="w-full bg-white dark:bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:bg-white dark:focus:bg-transparent border border-gray-300 dark:border-gray-600" type="text" placeholder="请输入服务器名称" value={customProfile.title} onChange={handleNameChanged} />
        <p className="text-sm mb-1 mt-2">{t("setting.system-section.customize-server.icon-url")}</p>
        <Input className="w-full bg-white dark:bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:bg-white dark:focus:bg-transparent border border-gray-300 dark:border-gray-600" type="text" placeholder="请输入图标URL地址" value={customProfile.logoUrl} onChange={handleLogoUrlChanged} />
        <p className="text-sm mb-1 mt-2">{t("setting.system-section.customize-server.description")}</p>
        <Textarea rows={3} fullWidth className="bg-white dark:bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:bg-white dark:focus:bg-transparent border border-gray-300 dark:border-gray-600" placeholder="请输入服务器描述" value={customProfile.description} onChange={handleDescriptionChanged} />
        <p className="text-sm mb-1 mt-2">{t("setting.system-section.customize-server.locale")}</p>
        <LocaleSelect className="w-full!" value={customProfile.locale} onChange={handleLocaleSelectChange} />
        <p className="text-sm mb-1 mt-2">{t("setting.system-section.customize-server.appearance")}</p>
        <AppearanceSelect className="w-full!" value={customProfile.appearance as Appearance} onChange={handleAppearanceSelectChange} />
        <div className="mt-4 w-full flex flex-row justify-between items-center space-x-2">
          <div className="flex flex-row justify-start items-center">
            <Button variant="outlined" className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700" onClick={handleRestoreButtonClick}>
              {t("common.restore")}
            </Button>
          </div>
          <div className="flex flex-row justify-end items-center gap-2">
            <Button variant="plain" className="text-gray-700 dark:text-gray-300" onClick={handleCloseButtonClick}>
              {t("common.cancel")}
            </Button>
            <Button color="primary" onClick={handleSaveButtonClick}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

function showUpdateCustomizedProfileDialog() {
  generateDialog(
    {
      className: "update-customized-profile-dialog",
      dialogName: "update-customized-profile-dialog",
    },
    UpdateCustomizedProfileDialog,
  );
}

export default showUpdateCustomizedProfileDialog;
