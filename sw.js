---
prefetch: [
  '/manifest.json',
  '/icons/apple-touch-180x180.png',
  '/icons/favicon-32x32.png'
]
---
'use strict';

{% assign BUILD_REV = site.github.build_revision %}
{% assign prefetch = page.prefetch %}

{% comment %}
Add site css to prefetch.
{% endcomment %}
{% assign href = '/assets/css/main.css?v=${ BUILD_REV }' %}
{% assign prefetch = prefetch | push:href %}

{% comment %}
Add docs script to prefetch.
{% endcomment %}
{% assign href = '/assets/js/docs.js?v=${ BUILD_REV }' %}
{% assign prefetch = prefetch | push:href %}

{% comment %}
Add static files to prefetch.
{% endcomment %}
{% for file in site.static_files %}
  {% unless site.github.hostname != 'github.com' and file.path contains 'favicon-16x16' %}
    {% assign prefetch = prefetch | push:file.path %}
  {% endunless %}
{% endfor %}

{% comment %}
Add html pages to prefetch.
{% endcomment %}
{% for page in site.html_pages %}
  {% assign href = '/' | append:page.path %}
  {% assign prefetch = prefetch | push:href %}
{% endfor %}

{% comment %}
Add Lodash scripts to prefetch.
{% endcomment %}
{% for release in site.releases %}
  {% assign href = 'https://cdn.jsdelivr.net/lodash/' | append:release | append:'/lodash.min.js' %}
  {% assign prefetch = prefetch | push:href %}
{% endfor %}

{% comment %}
Add vendor files to prefetch.
{% endcomment %}
{% for vendor in site.vendor %}
  {% for href in vendor[1] %}
    {% assign prefetch = prefetch | push:href %}
  {% endfor %}
{% endfor %}

const BUILD_REV = '{{ BUILD_REV }}';

const prefetch = [
  `{{ prefetch | uniq | join:'`,`' }}`
];

/**
 * Appends a cache-bust query to same-origin URIs and requests.
 *
 * @private
 * @param {*} resource The resource to cache bust.
 * @returns {*} Returns the cache busted resource.
 */
function bust(resource) {
  const isReq = resource instanceof Request;
  const isStr = typeof resource == 'string';
  const url = new URL(isReq ? resource.url : resource, location.href);

  // Use cache-bust query until cache modes are supported in Chrome.
  // Only add to same-origin requests to avoid potential 403 responses.
  // See https://github.com/mjackson/npm-http-server/issues/44.
  if (url.origin == location.origin) {
    if (!url.searchParams.has('v')) {
      url.searchParams.set('v', BUILD_REV);
    }
    if (isReq) {
      return new Request(url, resource);
    }
    return isStr ? url.href : url;
  }
  return resource;
}

/**
 * A specialized version of `Cache#put` which caches an additional extensionless
 * resource for HTML requests.
 *
 * @private
 * @param {Object} cache The cache object
 * @param {*} resource The resource key.
 * @param {Object} response The response value.
 * @returns {Promise} Returns a promise that resolves to `undefined`.
 */
function put(cache, resource, response) {
  const isReq = resource instanceof Request;
  const url = new URL(isReq ? resource.url : resource, location.href);
  if (url.pathname.endsWith('.html')) {
    const extless = new URL(url);
    extless.pathname = extless.pathname.replace(/(?:index)?\.html$/, '');
    cache.put(new Request(extless, isReq ? resource : undefined), response.clone());
  }
  return cache.put(resource, response);
}

/*----------------------------------------------------------------------------*/

addEventListener('install', event =>
  event.waitUntil(Promise.all([
    skipWaiting(),
    caches.open(BUILD_REV).then(cache =>
      Promise.all(prefetch.map(uri => {
        const input = bust(uri);
        // Attempt to prefetch and cache with 'cors'.
        return fetch(input)
          .then(response => response.ok && put(cache, uri, response))
          .catch(() =>
            // Fallback to prefetch and cache with 'no-cors'.
            fetch(input, { 'mode': 'no-cors' })
              .then(response => {
                if (response.status && !response.ok) {
                  throw new TypeError('Response status is !ok');
                }
                put(cache, uri, response);
              })
              // Prefetch failed.
              .catch(error => console.log(`prefetch failed: ${ uri }`, error))
          );
      }))
    )
  ]))
);

addEventListener('activate', event =>
  event.waitUntil(Promise.all([
    clients.claim(),
    // Delete old caches.
    caches.keys().then(keys =>
      Promise.all(keys.map(key =>
        key == BUILD_REV || caches.delete(key)
      ))
    )
  ]))
);

addEventListener('fetch', event =>
  event.respondWith(
    caches.open(BUILD_REV).then(cache =>
      // Respond with cached request if available.
      cache.match(event.request).then(response => {
        if (response || !prefetch.includes(event.request.url)) {
          return response || fetch(event.request);
        }
        const input = bust(event.request);
        // Retry caching if missed during prefetch.
        return fetch(input).then(response => {
          if (response.ok || !response.status) {
            put(cache, event.request, response.clone());
          }
          return response;
        })
        .catch(error => {
          // Respond with a 400 "Bad Request" status.
          console.log(`fetch failed: ${ event.request.url }`, error);
          return new Response(new Blob, { 'status': 400, 'statusText': 'Bad Request' });
        })
      })
    )
  )
);
