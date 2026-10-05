import type { PageSearchParams } from '@/lib/search-params';
import { TalkDayView } from '../_talks/day-view';

export default function WorkshopsPage({ searchParams }: { searchParams: PageSearchParams }) {
  return <TalkDayView kind="workshops" searchParams={searchParams} />;
}
