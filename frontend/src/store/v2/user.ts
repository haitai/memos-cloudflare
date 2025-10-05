import { uniqueId } from "lodash-es";
import { makeAutoObservable } from "mobx";
import { authServiceClient, inboxServiceClient, shortcutServiceClient, userServiceClient } from "@/grpcweb";
import { Inbox } from "@/types/proto/api/v1/inbox_service";
import { Shortcut } from "@/types/proto/api/v1/shortcut_service";
import { User, UserSetting, UserStats } from "@/types/proto/api/v1/user_service";
import { findNearestMatchedLanguage } from "@/utils/i18n";
import workspaceStore from "./workspace";

class LocalState {
  currentUser?: string;
  userSetting?: UserSetting;
  shortcuts: Shortcut[] = [];
  inboxes: Inbox[] = [];
  userMapByName: Record<string, User> = {};
  userStatsByName: Record<string, UserStats> = {};

  // The state id of user stats map.
  statsStateId = uniqueId();

  get tagCount() {
    const tagCount: Record<string, number> = {};
    console.log('🏷️ userStore.tagCount - userStatsByName:', this.userStatsByName);
    for (const stats of Object.values(this.userStatsByName)) {
      console.log('🏷️ userStore.tagCount - processing stats:', stats);
      for (const tag of Object.keys(stats.tagCount)) {
        tagCount[tag] = (tagCount[tag] || 0) + stats.tagCount[tag];
      }
    }
    console.log('🏷️ userStore.tagCount - final result:', tagCount);
    return tagCount;
  }

  get currentUserStats() {
    if (!this.currentUser) {
      return undefined;
    }
    return this.userStatsByName[this.currentUser];
  }

  constructor() {
    makeAutoObservable(this);
  }

  setPartial(partial: Partial<LocalState>) {
    Object.assign(this, partial);
  }
}

const userStore = (() => {
  const state = new LocalState();

  const getOrFetchUserByName = async (name: string) => {
    const userMap = state.userMapByName;
    if (userMap[name]) {
      return userMap[name] as User;
    }
    const user = await userServiceClient.getUser({
      name: name,
    });
    state.setPartial({
      userMapByName: {
        ...userMap,
        [name]: user,
      },
    });
    return user;
  };

  const getOrFetchUserByUsername = async (username: string) => {
    const userMap = state.userMapByName;
    for (const name in userMap) {
      if (userMap[name].username === username) {
        return userMap[name];
      }
    }
    const user = await userServiceClient.getUserByUsername({
      username,
    });
    state.setPartial({
      userMapByName: {
        ...userMap,
        [user.name]: user,
      },
    });
    return user;
  };

  const getUserByName = (name: string) => {
    return state.userMapByName[name];
  };

  const fetchUsers = async () => {
    const { users } = await userServiceClient.listUsers({});
    const userMap = state.userMapByName;
    for (const user of users) {
      userMap[user.name] = user;
    }
    state.setPartial({
      userMapByName: userMap,
    });
    return users;
  };

  const updateUser = async (user: Partial<User>, updateMask: string[]) => {
    const updatedUser = await userServiceClient.updateUser({
      user,
      updateMask,
    });
    state.setPartial({
      userMapByName: {
        ...state.userMapByName,
        [updatedUser.name]: updatedUser,
      },
    });
  };

  const deleteUser = async (name: string) => {
    await userServiceClient.deleteUser({ name });
    const userMap = state.userMapByName;
    delete userMap[name];
    state.setPartial({
      userMapByName: userMap,
    });
  };

  const updateUserSetting = async (userSetting: Partial<UserSetting>, updateMask: string[]) => {
    console.log("🔧 updateUserSetting called - v2025-07-11-13:17:00");
    console.log("📤 Sending user setting:", JSON.stringify(userSetting, null, 2));
    console.log("📝 Update mask:", updateMask);
    
    try {
      const updatedUserSetting = await userServiceClient.updateUserSetting({
        setting: userSetting,
        updateMask: updateMask,
      });
      
      console.log("✅ User setting updated successfully:", updatedUserSetting);
      state.setPartial({
        userSetting: UserSetting.fromPartial({
          ...state.userSetting,
          ...updatedUserSetting,
        }),
      });
    } catch (error) {
      console.error("❌ updateUserSetting failed:", error);
      throw error;
    }
  };

  const fetchShortcuts = async () => {
    if (!state.currentUser) {
      return;
    }

    const { shortcuts } = await shortcutServiceClient.listShortcuts({ parent: state.currentUser });
    state.setPartial({
      shortcuts,
    });
  };

  const fetchInboxes = async () => {
    const { inboxes } = await inboxServiceClient.listInboxes({});
    state.setPartial({
      inboxes,
    });
  };

  const updateInbox = async (inbox: Partial<Inbox>, updateMask: string[]) => {
    const updatedInbox = await inboxServiceClient.updateInbox({
      inbox,
      updateMask,
    });
    state.setPartial({
      inboxes: state.inboxes.map((i) => {
        if (i.name === updatedInbox.name) {
          return updatedInbox;
        }
        return i;
      }),
    });
    return updatedInbox;
  };

  const fetchUserStats = async (user?: string) => {
    console.log('🔄 fetchUserStats called with user:', user);
    const userStatsByName: Record<string, UserStats> = {};
    if (!user) {
      console.log('📊 Fetching all user stats...');
      const { userStats } = await userServiceClient.listAllUserStats({});
      console.log('📊 All user stats received:', userStats);
      for (const stats of userStats) {
        userStatsByName[stats.name] = stats;
      }
    } else {
      console.log('📊 Fetching stats for user:', user);
      const userStats = await userServiceClient.getUserStats({ name: user });
      console.log('📊 User stats received:', userStats);
      userStatsByName[user] = userStats;
    }
    console.log('📊 Setting userStatsByName:', userStatsByName);
    state.setPartial({
      userStatsByName: {
        ...state.userStatsByName,
        ...userStatsByName,
      },
    });
    console.log('📊 Final userStatsByName state:', state.userStatsByName);
    console.log('📊 Final tagCount:', state.tagCount);
  };

  const setStatsStateId = (id = uniqueId()) => {
    state.statsStateId = id;
  };

  return {
    state,
    getOrFetchUserByName,
    getOrFetchUserByUsername,
    getUserByName,
    fetchUsers,
    updateUser,
    deleteUser,
    updateUserSetting,
    fetchShortcuts,
    fetchInboxes,
    updateInbox,
    fetchUserStats,
    setStatsStateId,
  };
})();

export const initialUserStore = async () => {
  try {
    const currentUser = await authServiceClient.getAuthStatus({});
    let userSetting;
    
    try {
      userSetting = await userServiceClient.getUserSetting({});
    } catch (error) {
      console.warn('Failed to fetch user setting, using defaults:', error);
      // 如果获取用户设置失败，使用默认设置
      userSetting = {
        name: `users/1/setting`,
        locale: 'zh',
        appearance: 'system',
        memoVisibility: 'PRIVATE',
      };
    }
    
    userStore.state.setPartial({
      currentUser: currentUser.name,
      userSetting: UserSetting.fromPartial({
        ...userSetting,
      }),
      userMapByName: {
        [currentUser.name]: currentUser,
      },
    });
    workspaceStore.state.setPartial({
      locale: userSetting.locale,
      appearance: userSetting.appearance,
    });
  } catch {
    // find the nearest matched lang based on the `navigator.language` if the user is unauthenticated or settings retrieval fails.
    const locale = findNearestMatchedLanguage(navigator.language);
    workspaceStore.state.setPartial({
      locale: locale,
    });
  }
};

export default userStore;
