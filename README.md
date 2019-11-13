## Under Construction:
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



## License

[Apache 2.0](LICENSE.md)
