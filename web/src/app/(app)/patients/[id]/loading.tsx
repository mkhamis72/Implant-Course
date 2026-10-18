import { PageSkeleton } from '@/components/page-skeleton';

// The layout keeps the title and tabs on screen.
export default function Loading() {
  return <PageSkeleton header={false} />;
}
