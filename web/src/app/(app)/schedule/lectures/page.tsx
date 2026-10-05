import type { PageSearchParams } from '@/lib/search-params';
import { TalkDayView } from '../_talks/day-view';

export default function LecturesPage({ searchParams }: { searchParams: PageSearchParams }) {
  return <TalkDayView kind="lectures" searchParams={searchParams} />;
}
