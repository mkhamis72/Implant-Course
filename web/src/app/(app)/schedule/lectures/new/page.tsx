import type { PageSearchParams } from '@/lib/search-params';
import { NewTalkPage } from '../../_talks/new-talk-page';

export default function NewLectureTalkPage({ searchParams }: { searchParams: PageSearchParams }) {
  return <NewTalkPage kind="lectures" searchParams={searchParams} />;
}
