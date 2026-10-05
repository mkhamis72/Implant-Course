import type { PageSearchParams } from '@/lib/search-params';
import { NewTalkPage } from '../../_talks/new-talk-page';

export default function NewWorkshopTalkPage({ searchParams }: { searchParams: PageSearchParams }) {
  return <NewTalkPage kind="workshops" searchParams={searchParams} />;
}
