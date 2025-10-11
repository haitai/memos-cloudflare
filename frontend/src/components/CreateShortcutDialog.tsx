import { Input, Textarea, Button } from "@usememos/mui";
import { XIcon, InfoIcon, TagIcon, CalendarIcon, PinIcon, LinkIcon, CodeIcon, ListIcon } from "lucide-react";
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import { shortcutServiceClient } from "@/grpcweb";
import useCurrentUser from "@/hooks/useCurrentUser";
import useLoading from "@/hooks/useLoading";
import { userStore } from "@/store/v2";
import memoFilterStore from "@/store/v2/memoFilter";
import { Shortcut } from "@/types/proto/api/v1/shortcut_service";
import { useTranslate } from "@/utils/i18n";
import { generateUUID } from "@/utils/uuid";
import { generateDialog } from "./Dialog";

interface Props extends DialogProps {
  shortcut?: Shortcut;
}

// 预设筛选条件
const filterPresets = [
  { name: "📌 置顶备忘录", filter: "pinned == true", icon: PinIcon },
  { name: "🔗 包含链接", filter: "has_link == true", icon: LinkIcon },
  { name: "💻 包含代码", filter: "has_code == true", icon: CodeIcon },
  { name: "📋 包含任务列表", filter: "has_task_list == true", icon: ListIcon },
  { name: "📅 今天创建", filter: `display_time_after == ${Math.floor(Date.now() / 1000) - 24 * 60 * 60}`, icon: CalendarIcon },
  { name: "📅 本周创建", filter: `display_time_after == ${Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60}`, icon: CalendarIcon },
];

const CreateShortcutDialog: React.FC<Props> = (props: Props) => {
  const { destroy } = props;
  const t = useTranslate();
  const user = useCurrentUser();
  const [shortcut, setShortcut] = useState<Shortcut>({
    id: props.shortcut?.id || "",
    title: props.shortcut?.title || "",
    payload: props.shortcut?.payload || { filter: "" },
  });
  const [showPresets, setShowPresets] = useState(false);
  const [filterError, setFilterError] = useState<string>("");
  const requestState = useLoading(false);
  const isCreating = !props.shortcut;

  const onShortcutTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setShortcut({ ...shortcut, title: e.target.value });
  };

  const onShortcutFilterChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newFilter = e.target.value;
    setShortcut({ ...shortcut, payload: { ...shortcut.payload, filter: newFilter } });
    
    // 实时验证
    if (newFilter.trim()) {
      const validation = validateFilter(newFilter);
      setFilterError(validation.isValid ? "" : validation.error || "");
    } else {
      setFilterError("");
    }
  };

  // 使用当前筛选条件
  const useCurrentFilter = () => {
    const currentFilter = memoFilterStore.filters;
    if (currentFilter.length === 0) {
      toast.error("当前没有应用任何筛选条件");
      return;
    }
    
    // 将当前筛选条件转换为filter字符串
    const conditions = [];
    const contentSearch: string[] = [];
    const tagSearch: string[] = [];
    
    for (const filter of currentFilter) {
      if (filter.factor === "contentSearch") {
        contentSearch.push(`"${filter.value}"`);
      } else if (filter.factor === "tagSearch") {
        tagSearch.push(`"${filter.value}"`);
      } else if (filter.factor === "pinned") {
        conditions.push(`pinned == true`);
      } else if (filter.factor === "property.hasLink") {
        conditions.push(`has_link == true`);
      } else if (filter.factor === "property.hasTaskList") {
        conditions.push(`has_task_list == true`);
      } else if (filter.factor === "property.hasCode") {
        conditions.push(`has_code == true`);
      } else if (filter.factor === "displayTime") {
        const filterDate = new Date(filter.value);
        const filterUtcTimestamp = filterDate.getTime() + filterDate.getTimezoneOffset() * 60 * 1000;
        const timestampAfter = filterUtcTimestamp / 1000;
        conditions.push(`display_time_after == ${timestampAfter}`);
        conditions.push(`display_time_before == ${timestampAfter + 60 * 60 * 24}`);
      }
    }
    
    if (contentSearch.length > 0) {
      conditions.push(`content_search == [${contentSearch.join(", ")}]`);
    }
    if (tagSearch.length > 0) {
      conditions.push(`tag_search == [${tagSearch.join(", ")}]`);
    }
    
    const filterString = conditions.join(" && ");
    setShortcut({ ...shortcut, payload: { ...shortcut.payload, filter: filterString } });
    toast.success("已应用当前筛选条件");
  };

  // 使用预设筛选条件
  const usePreset = (preset: typeof filterPresets[0]) => {
    setShortcut({ 
      ...shortcut, 
      title: preset.name,
      payload: { ...shortcut.payload, filter: preset.filter } 
    });
    setShowPresets(false);
    toast.success(`已应用预设: ${preset.name}`);
  };

  // 验证筛选条件
  const validateFilter = (filter: string): { isValid: boolean; error?: string } => {
    if (!filter.trim()) {
      return { isValid: false, error: "筛选条件不能为空" };
    }

    // 基本语法检查
    const validOperators = ['==', '!=', '>', '<', '>=', '<='];
    const validFields = ['tag', 'pinned', 'has_link', 'has_code', 'has_task_list', 'display_time_after', 'display_time_before', 'content_search', 'tag_search'];
    
    // 检查是否包含有效的操作符
    const hasValidOperator = validOperators.some(op => filter.includes(op));
    if (!hasValidOperator) {
      return { isValid: false, error: "必须包含有效的操作符 (==, !=, >, <, >=, <=)" };
    }

    // 检查括号匹配
    const openParens = (filter.match(/\(/g) || []).length;
    const closeParens = (filter.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return { isValid: false, error: "括号不匹配" };
    }

    // 检查引号匹配
    const singleQuotes = (filter.match(/'/g) || []).length;
    const doubleQuotes = (filter.match(/"/g) || []).length;
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
      return { isValid: false, error: "引号不匹配" };
    }

    return { isValid: true };
  };

  const handleConfirm = async () => {
    if (!shortcut.title || !shortcut.payload?.filter) {
      toast.error("标题和筛选条件不能为空");
      return;
    }

    // 验证筛选条件
    const validation = validateFilter(shortcut.payload.filter);
    if (!validation.isValid) {
      toast.error(validation.error);
      return;
    }

    try {
      if (isCreating) {
        await shortcutServiceClient.createShortcut({
          parent: user.name,
          shortcut: {
            ...shortcut,
            id: generateUUID(),
          },
        });
        toast.success("Create shortcut successfully");
      } else {
        await shortcutServiceClient.updateShortcut({ parent: user.name, shortcut });
        toast.success("Update shortcut successfully");
      }
      // Refresh shortcuts.
      await userStore.fetchShortcuts();
      destroy();
    } catch (error: any) {
      console.error(error);
      toast.error(error.details);
    }
  };

  return (
    <div className="max-w-full shadow flex flex-col justify-start items-start bg-white dark:bg-zinc-800 dark:text-gray-300 p-4 rounded-lg">
      <div className="flex flex-row justify-between items-center mb-4 gap-2 w-full">
        <p className="title-text">{`${isCreating ? t("common.create") : t("common.edit")} ${t("common.shortcuts")}`}</p>
        <Button variant="plain" className="text-gray-700 dark:text-gray-300" onClick={() => destroy()}>
          <XIcon className="w-5 h-auto" />
        </Button>
      </div>
      <div className="flex flex-col justify-start items-start max-w-md min-w-72">
        <div className="w-full flex flex-col justify-start items-start mb-3">
          <span className="text-sm whitespace-nowrap mb-1">{t("common.title")}</span>
          <Input className="w-full bg-white dark:bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:bg-white dark:focus:bg-transparent border border-gray-300 dark:border-gray-600" type="text" placeholder="请输入捷径名称，例如：工作备忘录" value={shortcut.title} onChange={onShortcutTitleChange} />
          
          <div className="w-full flex flex-row justify-between items-center mt-3 mb-2">
            <span className="text-sm whitespace-nowrap">{t("common.filter")}</span>
            <div className="flex flex-row gap-2">
              <Button 
                size="sm" 
                variant="outlined" 
                className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={useCurrentFilter}
                disabled={memoFilterStore.filters.length === 0}
              >
                使用当前筛选
              </Button>
              <Button 
                size="sm" 
                variant="outlined" 
                className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => setShowPresets(!showPresets)}
              >
                预设条件
              </Button>
            </div>
          </div>
          
          {showPresets && (
            <div className="w-full mb-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm font-medium mb-2">常用筛选条件:</div>
              <div className="grid grid-cols-1 gap-2">
                {filterPresets.map((preset, index) => {
                  const IconComponent = preset.icon;
                  return (
                    <button
                      key={index}
                      onClick={() => usePreset(preset)}
                      className="flex items-center gap-2 p-2 text-left hover:bg-gray-100 dark:hover:bg-gray-600 rounded text-sm"
                    >
                      <IconComponent className="w-4 h-4" />
                      <span>{preset.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          
          <Textarea
            rows={4}
            fullWidth
            className="bg-white dark:bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:bg-white dark:focus:bg-transparent border border-gray-300 dark:border-gray-600"
            placeholder="请输入筛选条件，例如: tag_search == ['工作'] && pinned == true"
            value={shortcut.payload?.filter || ""}
            onChange={onShortcutFilterChange}
            error={!!filterError}
          />
          {filterError && (
            <div className="text-red-500 text-xs mt-1 flex items-center gap-1">
              <span>⚠️</span>
              <span>{filterError}</span>
            </div>
          )}
        </div>
        <div className="w-full opacity-70">
          <div className="flex items-center gap-2 mb-2">
            <InfoIcon className="w-4 h-4" />
            <p className="text-sm font-medium">筛选条件语法:</p>
          </div>
          <div className="text-xs space-y-1 pl-6">
            <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">tag_search == ['标签名']</code> - 按标签筛选</div>
            <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">content_search == ['关键词']</code> - 按内容搜索</div>
            <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">pinned == true</code> - 置顶备忘录</div>
            <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">has_link == true</code> - 包含链接</div>
            <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">has_code == true</code> - 包含代码</div>
            <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">has_task_list == true</code> - 包含任务列表</div>
            <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">display_time_after == 时间戳</code> - 时间范围</div>
            <div className="text-blue-600 hover:underline cursor-pointer" onClick={() => window.open('https://www.usememos.com/docs/guides/shortcuts', '_blank')}>
              查看完整文档 →
            </div>
          </div>
        </div>
        <div className="w-full flex flex-row justify-end items-center space-x-2 mt-2">
          <Button variant="plain" className="text-gray-700 dark:text-gray-300" disabled={requestState.isLoading} onClick={destroy}>
            {t("common.cancel")}
          </Button>
          <Button color="primary" disabled={requestState.isLoading} onClick={handleConfirm}>
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
};

function showCreateShortcutDialog(props: Pick<Props, "shortcut">) {
  generateDialog(
    {
      className: "create-shortcut-dialog",
      dialogName: "create-shortcut-dialog",
    },
    CreateShortcutDialog,
    props,
  );
}

export default showCreateShortcutDialog;
