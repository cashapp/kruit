![Node View Screenshot](https://raw.githubusercontent.com/cashapp/kuitk/master/docs/kruit_node_view.png "")



## Quick Start
```bash

# Clone this repository
git clone https://github.com/cashapp/kruit

# Go into the repository
cd kruit

# Install dependencies
npm install

# Run tsc on the sample plugins
./sample_plugins/build_samples.sh

# use the same plugin dir, this will default to ~/.kruit/plugins otherwise.
export KRUIT_PLUGIN_DIR="./sample_plugins"

# export the kubeconfig you wish to use
 export KUBECONFIG=<path to kubeconfig file>

# Run the app
npm start
```

## Writing Plugins

Writing a new plugin for kruit is easy. The best way to starty is by looking at one of our well documented [sample](https://github.com/cashapp/kuitk/blob/master/sample_plugins/node_view/src/node_view.ts) [plugins](https://github.com/cashapp/kuitk/blob/master/sample_plugins/namespace_view/src/namespace_view.ts). 


## License

[Apache 2.0](LICENSE.md)
