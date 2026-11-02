"""Refresh verified counts from the owner's public Scholar profile.

A blocked request, CAPTCHA, incomplete page, or unmatched title never becomes 0.
Only a matched Scholar article with an empty citation cell means zero citations.
"""
import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import Request, urlopen

PROFILE_ID = 'St1xlXQAAAAJ'
PROFILE_URL = f'https://scholar.google.com/citations?user={PROFILE_ID}&hl=en&pagesize=100'


def normalize_title(title):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', title).lower())


class ScholarRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get('class', '').split()
        if tag == 'tr' and 'gsc_a_tr' in classes:
            self.row = {'title': '', 'citations': '', 'citation_cell': False, 'url': ''}
        if self.row is None:
            return
        if tag == 'a' and 'gsc_a_at' in classes:
            self.capture = 'title'
            self.row['article_url'] = urljoin(PROFILE_URL, attrs.get('href', ''))
        elif tag == 'a' and 'gsc_a_ac' in classes:
            self.capture = 'citations'
            self.row['citation_cell'] = True
            self.row['url'] = urljoin(PROFILE_URL, attrs.get('href', ''))

    def handle_data(self, data):
        if self.row is not None and self.capture:
            self.row[self.capture] += data

    def handle_endtag(self, tag):
        if tag == 'a':
            self.capture = None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None
            self.capture = None


def refresh(data, html, checked_at):
    parser = ScholarRows()
    parser.feed(html)
    if not parser.rows:
        raise ValueError('Scholar returned no article rows; the page may be blocked. Existing counts preserved.')
    matches = 0
    for row in parser.rows:
        article = urlparse(row.get('article_url', ''))
        params = parse_qs(article.query)
        if article.hostname != 'scholar.google.com' or params.get('user') != [PROFILE_ID]:
            raise ValueError('Article does not belong to the configured Scholar profile')
        if not row['citation_cell']:
            raise ValueError('Missing citation cell; existing counts preserved')
        digits = re.sub(r'[,\s]', '', row['citations'])
        if digits and not digits.isascii() or digits and not digits.isdigit():
            raise ValueError('Invalid citation count; existing counts preserved')
        title = normalize_title(row['title'])
        for paper in data['papers'].values():
            if normalize_title(paper['title']) == title:
                count = int(digits) if digits else 0
                citation_url = row['url'] if digits else row['article_url']
                if urlparse(citation_url).hostname != 'scholar.google.com':
                    raise ValueError('Unexpected citation link host')
                # Avoid a daily commit when the source has not changed.
                if paper.get('count') != count or paper.get('url') != citation_url:
                    paper.update(count=count, url=citation_url, checkedAt=checked_at)
                matches += 1
    if not matches:
        raise ValueError('No exact paper titles matched; existing counts preserved')
    return matches


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--data', required=True)
    options = args.parse_args()
    path = Path(options.data)
    data = json.loads(path.read_text())
    if data['provider'] != 'google-scholar' or data['profileId'] != PROFILE_ID:
        raise ValueError('Unexpected citation source')
    request = Request(PROFILE_URL, headers={'User-Agent': 'QiruiAcademicHomepage/1.0 (+https://neuqrui.github.io/)'})
    with urlopen(request, timeout=25) as response:
        html = response.read().decode('utf-8')
    count = refresh(data, html, datetime.now(timezone.utc).isoformat())
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f'Verified {count} paper(s) directly from Google Scholar.')


if __name__ == '__main__':
    main()
