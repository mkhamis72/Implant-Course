import { EditTalkPage } from '../../../_talks/edit-talk-page';

export default function EditWorkshopTalkPage({ params }: { params: Promise<{ id: string }> }) {
  return <EditTalkPage kind="workshops" params={params} />;
}
