import { Divider, List, ListItem, Radio, RadioGroup, Tooltip } from "@mui/joy";
import { Button, Input } from "@usememos/mui";
import { isEqual } from "lodash-es";
import { HelpCircleIcon } from "lucide-react";
import { observer } from "mobx-react-lite";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";
import { workspaceSettingNamePrefix } from "@/store/common";
import { workspaceStore } from "@/store/v2";
import { WorkspaceSettingKey } from "@/store/v2/workspace";
import {
  WorkspaceStorageSetting,
  WorkspaceStorageSetting_StorageType,
} from "@/types/proto/api/v1/workspace_setting_service";
import { useTranslate } from "@/utils/i18n";

const StorageSection = observer(() => {
  const t = useTranslate();
  const [workspaceStorageSetting, setWorkspaceStorageSetting] = useState<WorkspaceStorageSetting>(
    WorkspaceStorageSetting.fromPartial(workspaceStore.getWorkspaceSettingByKey(WorkspaceSettingKey.STORAGE)?.storageSetting || {}),
  );

  useEffect(() => {
    setWorkspaceStorageSetting(
      WorkspaceStorageSetting.fromPartial(workspaceStore.getWorkspaceSettingByKey(WorkspaceSettingKey.STORAGE)?.storageSetting || {}),
    );
  }, [workspaceStore.getWorkspaceSettingByKey(WorkspaceSettingKey.STORAGE)]);

  const allowSaveStorageSetting = useMemo(() => {
    if (workspaceStorageSetting.uploadSizeLimitMb <= 0) {
      return false;
    }

    const origin = WorkspaceStorageSetting.fromPartial(
      workspaceStore.getWorkspaceSettingByKey(WorkspaceSettingKey.STORAGE)?.storageSetting || {},
    );
    
    // 只支持R2存储，不需要额外的验证
    return !isEqual(origin, workspaceStorageSetting);
  }, [workspaceStorageSetting, workspaceStore.state]);

  const handleMaxUploadSizeChanged = async (event: React.FocusEvent<HTMLInputElement>) => {
    let num = parseInt(event.target.value);
    if (Number.isNaN(num)) {
      num = 0;
    }
    const update: WorkspaceStorageSetting = {
      ...workspaceStorageSetting,
      uploadSizeLimitMb: num,
    };
    setWorkspaceStorageSetting(update);
  };

  const handleFilepathTemplateChanged = async (event: React.FocusEvent<HTMLInputElement>) => {
    const update: WorkspaceStorageSetting = {
      ...workspaceStorageSetting,
      filepathTemplate: event.target.value,
    };
    setWorkspaceStorageSetting(update);
  };

  const handleStorageTypeChanged = async (storageType: WorkspaceStorageSetting_StorageType) => {
    const update: WorkspaceStorageSetting = {
      ...workspaceStorageSetting,
      storageType: storageType,
    };
    setWorkspaceStorageSetting(update);
  };

  const saveWorkspaceStorageSetting = async () => {
    await workspaceStore.upsertWorkspaceSetting({
      name: `${workspaceSettingNamePrefix}${WorkspaceSettingKey.STORAGE}`,
      storageSetting: workspaceStorageSetting,
    });
    toast.success("Updated");
  };

  return (
    <div className="w-full flex flex-col gap-2 pt-2 pb-4">
      <div className="font-medium text-gray-700 dark:text-gray-500">{t("setting.storage-section.current-storage")}</div>
      <RadioGroup
        orientation="horizontal"
        className="w-full"
        value={workspaceStorageSetting.storageType}
        onChange={(event) => {
          handleStorageTypeChanged(event.target.value as WorkspaceStorageSetting_StorageType);
        }}
      >
        <Radio value={WorkspaceStorageSetting_StorageType.DATABASE} label={t("setting.storage-section.type-database")} />
        <Radio value={WorkspaceStorageSetting_StorageType.LOCAL} label={t("setting.storage-section.type-local")} />
        <Radio value={WorkspaceStorageSetting_StorageType.R2} label="Cloudflare R2" />
      </RadioGroup>
      <div className="w-full flex flex-row justify-between items-center">
        <div className="flex flex-row items-center">
          <span className="text-gray-700 dark:text-gray-500 mr-1">{t("setting.system-section.max-upload-size")}</span>
          <Tooltip title={t("setting.system-section.max-upload-size-hint")} placement="top">
            <HelpCircleIcon className="w-4 h-auto" />
          </Tooltip>
        </div>
        <Input className="w-16 font-mono" value={workspaceStorageSetting.uploadSizeLimitMb} onChange={handleMaxUploadSizeChanged} />
      </div>
      {workspaceStorageSetting.storageType !== WorkspaceStorageSetting_StorageType.DATABASE && (
        <div className="w-full flex flex-row justify-between items-center">
          <span className="text-gray-700 dark:text-gray-500 mr-1">{t("setting.storage-section.filepath-template")}</span>
          <Input
            value={workspaceStorageSetting.filepathTemplate}
            placeholder="assets/{timestamp}_{filename}"
            onChange={handleFilepathTemplateChanged}
          />
        </div>
      )}
      <div>
        <Button color="primary" disabled={!allowSaveStorageSetting} onClick={saveWorkspaceStorageSetting}>
          {t("common.save")}
        </Button>
      </div>
      <Divider className="my-2!" />
      <div className="w-full mt-4">
        <p className="text-sm">{t("common.learn-more")}:</p>
        <List component="ul" marker="disc" size="sm">
          <ListItem>
            <Link
              className="text-sm text-blue-600 hover:underline"
              to="https://www.usememos.com/docs/advanced-settings/local-storage"
              target="_blank"
            >
              Docs - Local storage
            </Link>
          </ListItem>
          <ListItem>
            <Link
              className="text-sm text-blue-600 hover:underline"
              to="https://developers.cloudflare.com/r2/"
              target="_blank"
            >
              Cloudflare R2 Documentation
            </Link>
          </ListItem>
        </List>
      </div>
    </div>
  );
});

export default StorageSection;