import { EditTalkPage } from '../../../_talks/edit-talk-page';

export default function EditLectureTalkPage({ params }: { params: Promise<{ id: string }> }) {
  return <EditTalkPage kind="lectures" params={params} />;
}
