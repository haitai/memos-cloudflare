import dayjs from "dayjs";
import { countBy } from "lodash-es";
import { useMemo } from "react";
import userStore from "@/store/v2/user";
import { UserStats_MemoTypeStats } from "@/types/proto/api/v1/user_service";
import type { StatisticsData } from "@/types/statistics";

export const useStatisticsData = (): StatisticsData => {
  return useMemo(() => {
    console.log('📊 useStatisticsData - userStatsByName:', userStore.state.userStatsByName);
    const memoTypeStats = UserStats_MemoTypeStats.fromPartial({});
    const displayTimeList: Date[] = [];

    for (const stats of Object.values(userStore.state.userStatsByName)) {
      console.log('📊 useStatisticsData - processing stats:', stats);
      console.log('📊 useStatisticsData - memoDisplayTimestamps:', stats.memoDisplayTimestamps);
      displayTimeList.push(...stats.memoDisplayTimestamps);
      if (stats.memoTypeStats) {
        memoTypeStats.codeCount += stats.memoTypeStats.codeCount;
        memoTypeStats.linkCount += stats.memoTypeStats.linkCount;
        memoTypeStats.todoCount += stats.memoTypeStats.todoCount;
        memoTypeStats.undoCount += stats.memoTypeStats.undoCount;
      }
    }

    const activityStats = countBy(displayTimeList.map((date) => dayjs(date).format("YYYY-MM-DD")));
    console.log('📊 useStatisticsData - displayTimeList:', displayTimeList);
    console.log('📊 useStatisticsData - activityStats:', activityStats);

    return { memoTypeStats, activityStats };
  }, [userStore.state.userStatsByName]);
};
