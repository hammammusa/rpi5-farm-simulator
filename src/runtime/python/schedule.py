"""Compatible subset of the `schedule` package (dbader/schedule) using simulation time.

    schedule.every(10).seconds.do(job)
    schedule.every().day.at("06:30").do(irrigate)
    schedule.every().monday.at("08:00").do(report)
    while True:
        schedule.run_pending()
        time.sleep(1)
"""

import datetime
import functools
import re


class ScheduleError(Exception):
    pass


class ScheduleValueError(ScheduleError):
    pass


class IntervalError(ScheduleValueError):
    pass


class CancelJob:
    pass


def _now():
    return datetime.datetime.now()


class Scheduler:
    def __init__(self):
        self.jobs = []

    def run_pending(self):
        for job in sorted(j for j in self.jobs if j.should_run):
            self._run_job(job)

    def run_all(self, delay_seconds=0):
        from time import sleep
        for job in self.jobs[:]:
            self._run_job(job)
            sleep(delay_seconds)

    def get_jobs(self, tag=None):
        return [j for j in self.jobs if tag is None or tag in j.tags]

    def clear(self, tag=None):
        if tag is None:
            del self.jobs[:]
        else:
            self.jobs = [j for j in self.jobs if tag not in j.tags]

    def cancel_job(self, job):
        try:
            self.jobs.remove(job)
        except ValueError:
            pass

    def every(self, interval=1):
        return Job(interval, self)

    def _run_job(self, job):
        ret = job.run()
        if isinstance(ret, CancelJob) or ret is CancelJob:
            self.cancel_job(job)

    @property
    def next_run(self):
        return min(self.jobs).next_run if self.jobs else None

    @property
    def idle_seconds(self):
        return (self.next_run - _now()).total_seconds() if self.jobs else None


_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


class Job:
    def __init__(self, interval, scheduler=None):
        self.interval = interval
        self.latest = None
        self.job_func = None
        self.unit = None
        self.at_time = None
        self.last_run = None
        self.next_run = None
        self.start_day = None
        self.cancel_after = None
        self.tags = set()
        self.scheduler = scheduler

    def __lt__(self, other):
        return self.next_run < other.next_run

    def __repr__(self):
        return 'Every %s %s do %s' % (self.interval, self.unit, getattr(self.job_func, '__name__', self.job_func))

    def _unit(self, unit, single=False):
        if single and self.interval != 1:
            raise IntervalError('Use %ss instead of %s' % (unit, unit))
        self.unit = unit
        return self

    second = property(lambda self: self._unit('seconds', True))
    seconds = property(lambda self: self._unit('seconds'))
    minute = property(lambda self: self._unit('minutes', True))
    minutes = property(lambda self: self._unit('minutes'))
    hour = property(lambda self: self._unit('hours', True))
    hours = property(lambda self: self._unit('hours'))
    day = property(lambda self: self._unit('days', True))
    days = property(lambda self: self._unit('days'))
    week = property(lambda self: self._unit('weeks', True))
    weeks = property(lambda self: self._unit('weeks'))

    def _weekday(self, name):
        if self.interval != 1:
            raise IntervalError('Scheduling .%s() jobs is only allowed for weekly jobs.' % name)
        self.start_day = name
        self.unit = 'weeks'
        return self

    monday = property(lambda self: self._weekday('monday'))
    tuesday = property(lambda self: self._weekday('tuesday'))
    wednesday = property(lambda self: self._weekday('wednesday'))
    thursday = property(lambda self: self._weekday('thursday'))
    friday = property(lambda self: self._weekday('friday'))
    saturday = property(lambda self: self._weekday('saturday'))
    sunday = property(lambda self: self._weekday('sunday'))

    def tag(self, *tags):
        self.tags.update(tags)
        return self

    def at(self, time_str):
        if self.unit not in ('days', 'hours', 'minutes', 'weeks'):
            raise ScheduleValueError('Invalid unit (valid units are `days`, `hours`, `minutes` and weeks)')
        if self.unit == 'days' or self.start_day:
            m = re.match(r'^([0-2]\d):([0-5]\d)(?::([0-5]\d))?$', time_str)
        elif self.unit == 'hours':
            m = re.match(r'^(?:([0-5]\d))?:([0-5]\d)$', time_str)
        else:
            m = re.match(r'^(?::)?([0-5]\d)?$', time_str)
        if not m:
            raise ScheduleValueError('Invalid time format for a %s job (%s)' % (self.unit, time_str))
        parts = [int(x) if x else 0 for x in m.groups()]
        if self.unit == 'days' or self.start_day:
            h, mi = parts[0], parts[1]
            s = parts[2] if len(parts) > 2 else 0
        elif self.unit == 'hours':
            h, mi, s = 0, parts[0], parts[1]
        else:
            h, mi, s = 0, 0, parts[0]
        if h > 23:
            raise ScheduleValueError('Invalid hour %d' % h)
        self.at_time = datetime.time(h, mi, s)
        return self

    def to(self, latest):
        self.latest = latest
        return self

    def until(self, until_time):
        if isinstance(until_time, str):
            hh, mm = [int(x) for x in until_time.split(':')[:2]]
            n = _now()
            until_time = n.replace(hour=hh, minute=mm, second=0, microsecond=0)
        self.cancel_after = until_time
        return self

    def do(self, job_func, *args, **kwargs):
        self.job_func = functools.partial(job_func, *args, **kwargs)
        functools.update_wrapper(self.job_func, job_func)
        self._schedule_next_run()
        if self.scheduler is None:
            raise ScheduleError('Unable to add job to schedule. Job is not associated with a scheduler')
        self.scheduler.jobs.append(self)
        return self

    @property
    def should_run(self):
        return _now() >= self.next_run

    def run(self):
        if self.cancel_after is not None and _now() >= self.cancel_after:
            return CancelJob
        ret = self.job_func()
        self.last_run = _now()
        self._schedule_next_run()
        return ret

    def _schedule_next_run(self):
        if self.unit not in ('seconds', 'minutes', 'hours', 'days', 'weeks'):
            raise ScheduleValueError('Invalid unit — use e.g. every(5).seconds')
        interval = self.interval
        if self.latest is not None:
            import random
            interval = random.randint(self.interval, self.latest)
        period = datetime.timedelta(**{self.unit: interval})
        now = _now()
        self.next_run = now + period
        if self.start_day is not None:
            target = _DAYS.index(self.start_day)
            ahead = (target - self.next_run.weekday()) % 7
            self.next_run = (now + datetime.timedelta(days=(target - now.weekday()) % 7))
            if self.at_time is None:
                self.at_time = datetime.time(0, 0)
        if self.at_time is not None:
            kw = {'second': self.at_time.second, 'microsecond': 0}
            if self.unit == 'days' or self.start_day is not None:
                kw['hour'] = self.at_time.hour
            if self.unit in ('days', 'hours') or self.start_day is not None:
                kw['minute'] = self.at_time.minute
            base = now if self.last_run is None else self.next_run - period
            cand = base.replace(**kw)
            step = {'days': datetime.timedelta(days=1), 'hours': datetime.timedelta(hours=1), 'minutes': datetime.timedelta(minutes=1), 'weeks': datetime.timedelta(days=7)}[self.unit]
            if self.start_day is not None:
                cand = self.next_run.replace(**kw)
                step = datetime.timedelta(days=7)
            while cand <= now:
                cand += step
            if self.last_run is not None and self.unit != 'weeks':
                cand = max(cand, now)
                while cand <= now:
                    cand += step
            self.next_run = cand


default_scheduler = Scheduler()
jobs = default_scheduler.jobs


def every(interval=1):
    return default_scheduler.every(interval)


def run_pending():
    default_scheduler.run_pending()


def run_all(delay_seconds=0):
    default_scheduler.run_all(delay_seconds)


def get_jobs(tag=None):
    return default_scheduler.get_jobs(tag)


def clear(tag=None):
    default_scheduler.clear(tag)


def cancel_job(job):
    default_scheduler.cancel_job(job)


def next_run():
    return default_scheduler.next_run


def idle_seconds():
    return default_scheduler.idle_seconds


def _sim_reset():
    default_scheduler.clear()


def repeat(job, *args, **kwargs):
    def deco(fn):
        job.do(fn, *args, **kwargs)
        return fn
    return deco
