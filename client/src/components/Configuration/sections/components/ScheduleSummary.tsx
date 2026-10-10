import React from 'react';
import { Link } from 'react-router-dom';
import { describeSchedule, ScheduleKey } from '../../schedules';

// label names the task when a page shows more than one schedule, so the
// summaries (and their links, for screen readers) can be told apart.
export function ScheduleSummary({ scheduleKey, value, label }: { scheduleKey: ScheduleKey; value: string; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted-foreground">{label ?? 'Schedule'}: {describeSchedule(value)} (server time)</span>
      <Link
        className="underline font-medium"
        to={`/settings/scheduling#${scheduleKey}`}
        aria-label={label ? `Edit schedule for ${label.toLowerCase()}` : undefined}
      >
        Edit schedule
      </Link>
    </div>
  );
}
