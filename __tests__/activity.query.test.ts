import { apiRequest } from '../src/api/client';
import { listActivity } from '../src/activity/types';
import { listActivity as listActivityFromOfflineApi } from '../src/offline/api';
import type { ActivityResponse } from '../src/activity/types';

jest.mock('../src/api/client', () => ({
  apiRequest: jest.fn(),
}));

const request = apiRequest as jest.Mock;

const EMPTY: ActivityResponse = {
  events: [],
  summary: { received: 0, spent: 0, made: 0, capital: 0 },
  totalCount: 0,
  hasMore: false,
};

describe('listActivity query building', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    request.mockResolvedValue(EMPTY);
  });

  it('asks for /activity without a query string when nothing is set', async () => {
    await listActivity();
    expect(request).toHaveBeenCalledWith('/activity', { auth: true });
  });

  it('sends the preset period, the device day and paging together', async () => {
    await listActivity({ period: 'today', asOf: '2026-10-07', limit: 30, offset: 60 });

    expect(request).toHaveBeenCalledWith(
      '/activity?period=today&asOf=2026-10-07&limit=30&offset=60',
      { auth: true },
    );
  });

  it('sends an explicit day range without a preset period', async () => {
    await listActivity({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      asOf: '2026-02-01',
    });

    expect(request).toHaveBeenCalledWith(
      '/activity?startDate=2026-01-01&endDate=2026-01-31&asOf=2026-02-01',
      { auth: true },
    );
  });

  it('drops unset and empty values instead of sending blank parameters', async () => {
    await listActivity({
      period: undefined,
      startDate: '',
      endDate: undefined,
      asOf: '2026-10-07',
      offset: 0,
    });

    expect(request).toHaveBeenCalledWith('/activity?asOf=2026-10-07&offset=0', {
      auth: true,
    });
  });

  it('encodes values that are not safe in a URL', async () => {
    await listActivity({ startDate: '2026-01-01 10:30' });

    expect(request).toHaveBeenCalledWith('/activity?startDate=2026-01-01%2010%3A30', {
      auth: true,
    });
  });

  it('marks every returned event as synced for the local list', async () => {
    request.mockResolvedValue({
      ...EMPTY,
      events: [
        { id: 1, type: 'sale', amount: 500, eventDate: '2026-10-07', createdAt: 'x' },
      ],
      totalCount: 1,
    });

    const result = await listActivityFromOfflineApi({ period: 'today' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].syncStatus).toBe('synced');
  });
});
