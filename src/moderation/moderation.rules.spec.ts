import {
  canReport,
  REPORT_THRESHOLD,
  shouldHideForReports,
} from './moderation.rules';

describe('shouldHideForReports', () => {
  const hosted = { kind: 'HOSTED' as const, status: 'PUBLISHED' as const };

  it('hides a Published Hosted Event at the 3rd Open Report, not before', () => {
    expect(REPORT_THRESHOLD).toBe(3);
    expect(shouldHideForReports(hosted, 2)).toBe(false);
    expect(shouldHideForReports(hosted, 3)).toBe(true);
    expect(shouldHideForReports(hosted, 7)).toBe(true);
  });

  it('never hides Listed Events automatically', () => {
    expect(shouldHideForReports({ ...hosted, kind: 'LISTED' }, 50)).toBe(false);
  });

  it.each(['UNDER_REVIEW', 'CANCELLED', 'REMOVED', 'DRAFT'] as const)(
    'leaves a %s Event alone',
    (status) => {
      expect(shouldHideForReports({ ...hosted, status }, 10)).toBe(false);
    },
  );
});

describe('canReport', () => {
  it('allows Events people can see', () => {
    expect(canReport('PUBLISHED')).toBe(true);
    expect(canReport('CANCELLED')).toBe(true);
    expect(canReport('UNDER_REVIEW')).toBe(true);
  });

  it('refuses Drafts and Removed Events', () => {
    expect(canReport('DRAFT')).toBe(false);
    expect(canReport('REMOVED')).toBe(false);
  });
});
