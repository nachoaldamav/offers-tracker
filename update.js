require('dotenv').config({ path: `${__dirname}/.env` });
const Fs = require('fs');
const SimpleGit = require('simple-git');
const { GraphQLClient } = require('graphql-request');

const FetchStoreOffersQuery = Fs.readFileSync(`${__dirname}/queries/FetchStoreOffersQuery.graphql`, 'utf8');
const FetchStoreOffersByNamespaceQuery = Fs.readFileSync(`${__dirname}/queries/FetchStoreOffersByNamespaceQuery.graphql`, 'utf8');

class Main {
  constructor () {
    this.language = 'en';
    this.country = 'US';
    this.namespaces = []; // You can add here non-store namespaces e.g. ue (unreal engine market offers)
    this.perPage = 1000;
    this.trackingStats = {
      timeUnit: 'ms',
    };
    this.databasePath = `${__dirname}/database`;
    
    this.ql = new GraphQLClient('https://graphql.epicgames.com/graphql', {
      headers: {
        Origin: 'https://epicgames.com',
      },
    });

    this.update();
  }

  async update () {
    let checkpointTime;
    console.log('Updating epicgames store offers...');
    checkpointTime = Date.now();
    await this.fetchAllOffers(FetchStoreOffersQuery, {
      country: this.country,
      locale: this.language,
      sortBy: 'lastModifiedDate',
      sortDir: 'DESC',
    }, (result) => {
      return result && result.Catalog && result.Catalog.searchStore || {};
    });
    this.trackingStats.fetchStoreOffersTime = Date.now() - checkpointTime;
    
    checkpointTime = Date.now();
    for (let i = 0; i < this.namespaces.length; ++i) {
      const namespace = this.namespaces[i];
      console.log(`Updating offers for namespace ${namespace}...`);
      await this.fetchAllOffers(FetchStoreOffersByNamespaceQuery, {
        namespace,
        country: this.country,
        locale: this.language,
      }, (result) => {
        return result && result.Catalog && result.Catalog.catalogOffers || {};
      });
    }
    this.trackingStats.fetchStoreOffersByNamespaceTime = Date.now() - checkpointTime;
    
    checkpointTime = Date.now();
    this.index();
    this.trackingStats.indexTime = Date.now() - checkpointTime;
    
    this.trackingStats.fetchOffersTime = this.trackingStats.fetchStoreOffersTime + this.trackingStats.fetchStoreOffersByNamespaceTime;
    this.trackingStats.lastUpdate = Date.now();
    this.trackingStats.lastUpdateString = (new Date(this.trackingStats.lastUpdate)).toISOString();

    await this.sync();
  }
  
  index () {
    console.log('Indexing...');
    const namespaces = {};
    const titles = {};
    const list = [];
    const tags = {};
    
    const offersPath = `${this.databasePath}/offers`;
    Fs.readdirSync(offersPath).forEach((fileName) => {
      if (fileName.substr(-5) !== '.json') return;
      try {
        const offer = JSON.parse(Fs.readFileSync(`${offersPath}/${fileName}`));
        if (offer.namespace) {
          if (!namespaces[offer.namespace]) {
            namespaces[offer.namespace] = [offer.id];
          } else {
            namespaces[offer.namespace].push(offer.id);
          }
        }
        titles[offer.id] = offer.title;
        (offer.tags || []).filter(tag => tag).forEach(tag => tags[tag.id] = tag);
        const thumbnailImage = Array.isArray(offer.keyImages) && offer.keyImages.find(img => img.type === 'Thumbnail');
        list.push([
          offer.id,
          offer.namespace,
          offer.title,
          Array.isArray(offer.categories) && offer.categories.map(c => c.path) || [],
          offer.seller && offer.seller.name || '',
          offer.creationDate && Math.floor((new Date(offer.creationDate)).getTime() / 1000) || 0,
          offer.lastModifiedDate && Math.floor((new Date(offer.lastModifiedDate)).getTime() / 1000) || 0,
          thumbnailImage && thumbnailImage.url || '',
          offer.productSlug || '',
        ]);
      } catch (error) {
        console.error(error);
      }
    });
    
    Fs.writeFileSync(`${this.databasePath}/namespaces.json`, JSON.stringify(namespaces, null, 2));
    Fs.writeFileSync(`${this.databasePath}/titles.json`, JSON.stringify(titles, null, 2));
    Fs.writeFileSync(`${this.databasePath}/list.json`, JSON.stringify(list, null, 2));
    Fs.writeFileSync(`${this.databasePath}/tags.json`, JSON.stringify(tags, null, 2));
  }

  async sync () {
    if (!process.env.GIT_REMOTE) return;
    console.log('Syncing with repo...');
    const git = SimpleGit({
      baseDir: __dirname,
      binary: 'git',
    });
    await git.addConfig('hub.protocol', 'https');
    await git.checkoutBranch('master');
    await git.add([`${this.databasePath}/.`]);
    const status = await git.status();
    const changesCount = status.created.length + status.modified.length + status.deleted.length + status.renamed.length;
    if (changesCount === 0) return;
    Fs.writeFileSync(`${this.databasePath}/tracking-stats.json`, JSON.stringify(this.trackingStats, null, 2));
    await git.add([`${this.databasePath}/tracking-stats.json`]);
    const commitMessage = `Update - ${new Date().toISOString()}`;
    await git.commit(commitMessage);
    await git.removeRemote('origin');
    await git.addRemote('origin', process.env.GIT_REMOTE);
    await git.push(['-u', 'origin', 'master']);
    console.log(`Changes has commited to repo with message ${commitMessage}`);
  }
  
  saveOffer (offer) {
    try {
      Fs.writeFileSync(`${__dirname}/database/offers/${offer.id}.json`, JSON.stringify(offer, null, 2));
    } catch (error) {
      console.log(`${offer.id} = ERROR`);
      console.error(error);
    }
  }

  sleep (time) {
    return new Promise((resolve) => {
      const sto = setTimeout(() => {
        clearTimeout(sto);
        resolve();
      }, time);
    });
  }

  async fetchAllOffers (query, params, resultSelector) {
    let paging = {};
    do {
      const result = await this.fetchOffers(query, params, resultSelector, paging.start, paging.count || this.perPage);
      paging = result.paging;
      paging.start += paging.count;
      for (let i = 0; i < result.elements.length; ++i) {
        const element = result.elements[i];
        this.saveOffer(element);
      }
      await this.sleep(1000);
    } while (paging.start - this.perPage < paging.total - paging.count);
  }

  async fetchOffers (query, params, resultSelector, start = 0, count = 1000) {
    try {
      let result = await this.ql.request(query, {
        ...params,
        start,
        count,
      });
      result = resultSelector(result);
      return result;
    } catch (error) {
      if (error.response) {
        if (error.response.data) {
          const result = resultSelector(error.response.data);
          if (result && result.elements && result.paging) {
            return result;
          }
        }
        console.log(JSON.stringify(error.response, null, 2));
        console.log('Next attempt in 1s...');
        await this.sleep(5000);
        return this.fetchOffers(...arguments);
      } else {
        throw new Error(error);
      }
    }
  }
}

module.exports = new Main();
